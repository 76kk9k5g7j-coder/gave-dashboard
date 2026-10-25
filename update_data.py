#!/usr/bin/env python3
"""Télécharge les données gratuites, reconstruit les ratios de Charles Gave et écrit data/*.json.

Idempotent : chaque source brute est mise en cache dans cache/. Si un téléchargement échoue,
on réutilise la dernière copie en cache (et on le signale dans data/sources.json).
Usage : python update_data.py
"""
import io, json, time, datetime as dt
from pathlib import Path
import numpy as np, pandas as pd, requests

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache"; DATA = ROOT / "data"
CACHE.mkdir(exist_ok=True); DATA.mkdir(exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) gave-dashboard/1.0"}
MA_MONTHS = 84  # 7 ans
STATUS = {}

HOST_DOWN = set()  # hôtes qui ont déjà expiré pendant ce run : on passe directement au cache (fail-fast)

def fetch(name, url, binary=False, tries=2, timeout=(8, 30)):
    from urllib.parse import urlparse
    path = CACHE / name; host = urlparse(url).netloc
    err = None
    for i in range(0 if host in HOST_DOWN else tries):
        try:
            r = requests.get(url, headers=UA, timeout=timeout)
            r.raise_for_status()
            if len(r.content) < 200: raise ValueError("réponse trop courte")
            path.write_bytes(r.content)
            STATUS[name] = {"url": url, "ok": True, "cache": False}
            return path
        except Exception as e:
            err = e
            if isinstance(e, (requests.exceptions.Timeout, requests.exceptions.ConnectionError)):
                HOST_DOWN.add(host); break
            time.sleep(1 + i)
    if err is None: err = f"{host} injoignable plus tôt dans ce run, cache utilisé"
    if path.exists():
        STATUS[name] = {"url": url, "ok": False, "cache": True, "error": str(err)}
        print(f"[WARN] {name}: échec ({err}), utilisation du cache")
        return path
    STATUS[name] = {"url": url, "ok": False, "cache": False, "error": str(err)}
    raise RuntimeError(f"{name}: {err}")

def fred(series):
    p = fetch(f"fred_{series}.csv", f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}")
    df = pd.read_csv(p); df.columns = ["date", "v"]
    df["date"] = pd.to_datetime(df["date"]); df["v"] = pd.to_numeric(df["v"], errors="coerce")
    return df.dropna().set_index("date")["v"]

def yahoo(sym, interval="1mo", rng="max"):
    p = fetch(f"yahoo_{sym.replace('^','').replace('=','_')}_{interval}.json",
              f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?"
              + ("period1=0&period2=9999999999" if rng == "max" else f"range={rng}") + f"&interval={interval}")
    j = json.loads(p.read_text())["chart"]["result"][0]
    off = j["meta"].get("gmtoffset", 0) or 0  # dates en heure locale de la bourse
    ts = pd.to_datetime(np.array(j["timestamp"]) + off, unit="s")
    close = j["indicators"]["quote"][0]["close"]
    s = pd.Series(close, index=ts, dtype=float).dropna()
    return s

def to_month(s, how="last"):
    s = s.copy(); s.index = s.index.to_period("M")
    return s.groupby(level=0).last() if how == "last" else s.groupby(level=0).mean()

# ---------------------------------------------------------------- sources
def shiller():
    p = fetch("shiller_ie_data.xls",
              "https://img1.wsimg.com/blobby/go/e5e77e0b-59d1-44d9-ab25-4763ac982e53/downloads/ie_data.xls")
    d = pd.read_excel(p, engine="xlrd", sheet_name="Data", header=None, skiprows=8).iloc[:, :7]
    d.columns = ["date", "P", "D", "E", "CPI", "frac", "GS10"]
    d = d[pd.to_numeric(d["date"], errors="coerce").notna()].copy()
    d["date"] = d["date"].astype(float)
    y = d["date"].astype(int); m = ((d["date"] - y) * 100).round().astype(int)
    d.index = pd.PeriodIndex([pd.Period(f"{a}-{b:02d}", "M") for a, b in zip(y, m)])
    for c in ["P", "D", "GS10"]: d[c] = pd.to_numeric(d[c], errors="coerce")
    return d

def gold_monthly():
    p = fetch("gold_monthly_datahub.csv", "https://raw.githubusercontent.com/datasets/gold-prices/main/data/monthly.csv")
    g = pd.read_csv(p); g.index = pd.PeriodIndex(g["Date"], freq="M"); g = g["Price"].astype(float)
    try:  # prolonger avec le future COMEX (dernier cours connu, mis à jour chaque semaine)
        f = to_month(yahoo("GC=F", "1d", "6mo"))
        g = pd.concat([g, f[f.index > g.index[-1]]])
        if f.index[-1] == g.index[-1]: g.iloc[-1] = f.iloc[-1]
    except Exception as e: print("[WARN] GC=F", e)
    return g

def sp500_tr(sh):
    # Avant 1988 : indice "dividendes réinvestis" reconstruit à partir de Shiller (prix + dividende/12)
    P, D = sh["P"], sh["D"].ffill()
    r = (P + D / 12) / P.shift(1)
    tr = r.fillna(1).cumprod()
    y = to_month(yahoo("^SP500TR", "1mo", "max"))
    try:
        yd = to_month(yahoo("^SP500TR", "1d", "1mo"))
        y = pd.concat([y[y.index < yd.index[-1]], yd.iloc[[-1]]])
    except Exception as e: print("[WARN] SP500TR daily", e)
    k = pd.Period("1988-01", "M")
    tr = tr[tr.index <= k] * (y[k] / tr[k])
    return pd.concat([tr, y[y.index > k]])

def bond_yield(sh):
    gs = sh["GS10"].dropna()
    try:
        f = fred("GS10"); f.index = f.index.to_period("M")
        gs = pd.concat([gs[gs.index < f.index[0]], f])
    except Exception as e: print("[WARN] FRED GS10", e)
    try:
        t = to_month(yahoo("^TNX", "1d", "3mo"))
        gs = pd.concat([gs, t[t.index > gs.index[-1]]])
    except Exception as e: print("[WARN] TNX", e)
    return gs[~gs.index.duplicated(keep="last")].sort_index()

def bond_tr(yld):
    """Indice synthétique 'rendement total' d'un emprunt d'État US à 10 ans à taux fixe, roulé chaque mois."""
    y = yld / 100.0
    out = [1.0]
    for i in range(1, len(y)):
        c, y1, n = y.iloc[i - 1], y.iloc[i], 10 - 1 / 12
        k = 2 * n; h = y1 / 2
        price = (c / 2) / h * (1 - (1 + h) ** -k) + (1 + h) ** -k if h > 0 else 1
        out.append(out[-1] * (price + c / 12))
    return pd.Series(out, index=y.index)

# ---------------------------------------------------------------- analyse
def crossings(ratio, ma, label_above, label_below):
    valid = ma.dropna().index
    above = (ratio[valid] > ma[valid])
    ch = above.ne(above.shift()) & above.shift().notna()
    ev = [{"date": str(d), "to": label_above if above[d] else label_below} for d in above.index[ch]]
    return above, ev

def backtest(above, ret_above, ret_below):
    sig = above.shift(1).dropna().astype(bool)  # signal de fin de mois appliqué au mois suivant
    idx = sig.index.intersection(ret_above.index).intersection(ret_below.index)
    r = np.where(sig[idx], ret_above[idx], ret_below[idx])
    eq = pd.Series(np.cumprod(1 + r), index=idx)
    def stats(e):
        yrs = len(e) / 12
        return {"cagr": float(e.iloc[-1] ** (1 / yrs) - 1), "maxdd": float((e / e.cummax() - 1).min())}
    return {"start": str(idx[0]), "rule": stats(eq),
            "hold_above": stats((1 + ret_above[idx]).cumprod()),
            "hold_below": stats((1 + ret_below[idx]).cumprod())}

def series_json(ratio, ma):
    return {"dates": [str(d) for d in ratio.index],
            "ratio": [round(float(v), 4) for v in ratio.values],
            "ma": [None if pd.isna(v) else round(float(v), 4) for v in ma.reindex(ratio.index).values]}

def build_rule(ratio, label_above, label_below, ret_above, ret_below, min_periods=MA_MONTHS):
    ma = ratio.rolling(MA_MONTHS, min_periods=min_periods).mean()
    above, ev = crossings(ratio, ma, label_above, label_below)
    last = ratio.index[-1]
    since = ev[-1]["date"] if ev else str(ma.dropna().index[0])
    return {**series_json(ratio, ma), "events": ev,
            "current": {"date": str(last), "ratio": float(ratio.iloc[-1]), "ma": float(ma.iloc[-1]),
                        "above": bool(above.iloc[-1]), "since": since,
                        "signal": label_above if above.iloc[-1] else label_below,
                        "gap_pct": float(ratio.iloc[-1] / ma.iloc[-1] - 1)},
            "backtest": backtest(above, ret_above, ret_below)}


# ---------------------------------------------------------------- séries macro (AMECO, Eurostat, BIS)
AMECO_CODES = {f"{c}.{k}" for c in ("FRA", "GBR", "NLD", "DEU") for k in
               ("1.1.0.0.OVGD", "3.1.0.0.PVGD", "1.0.0.0.UCTG", "1.0.0.0.UUTG", "1.0.319.0.UDGGL", "1.0.319.0.UUTG",
                "1.0.0.0.UOGC", "1.0.0.0.ZUTN")}

def ameco():
    import zipfile
    p = fetch("ameco0.zip", "https://ec.europa.eu/economy_finance/db_indicators/ameco/documents/ameco0.zip")
    out = {}
    with zipfile.ZipFile(p) as z:
        for n in z.namelist():
            lines = z.read(n).decode("latin-1").splitlines()
            hdr = lines[0].rstrip(";").split(";")
            years = [int(y) for y in hdr[5:] if y.strip().isdigit()]
            for l in lines[1:]:
                c = l.rstrip(";").split(";")
                if c[0] in AMECO_CODES:
                    v = pd.to_numeric(pd.Series(c[5:5 + len(years)]).str.strip(), errors="coerce")
                    out[c[0]] = pd.Series(v.values, index=years).dropna()
    return out

def eurostat_q_debt(geo="FR"):
    p = fetch(f"eurostat_debt_q_{geo}.json", "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
              f"gov_10q_ggdebt?geo={geo}&na_item=GD&sector=S13&unit=PC_GDP&lastTimePeriod=16&format=JSON")
    j = json.loads(p.read_text())
    tidx = j["dimension"]["time"]["category"]["index"]
    return [{"q": t, "v": j["value"][str(i)]} for t, i in sorted(tidx.items(), key=lambda x: x[1]) if str(i) in j["value"]]

def bis_eer(kind, area):
    p = fetch(f"bis_eer_{kind}_{area}.csv", f"https://stats.bis.org/api/v1/data/WS_EER/M.{kind}.N.{area}/all?format=csv")
    d = pd.read_csv(p)
    s = pd.Series(pd.to_numeric(d["OBS_VALUE"], errors="coerce").values, index=pd.PeriodIndex(d["TIME_PERIOD"], freq="M"))
    return s.dropna().sort_index()

GRAMS_PER_OZ = 31.1034768

def build_dividends_gold(now, sh, gold):
    """Graphique 23 : dividendes (12 mois) du S&P 500 en dollars et en grammes d'or."""
    D = sh["D"].dropna()
    tr = to_month(yahoo("^SP500TR", "1mo", "max")); p = to_month(yahoo("^GSPC", "1mo", "max"))
    idx = tr.index.intersection(p.index); tr, p = tr[idx], p[idx]
    implied = ((tr / tr.shift(1)) * p.shift(1) - p).rolling(12).sum().dropna()  # dividendes implicites sur 12 mois
    ext = implied[implied.index > D.index[-1]]
    div = pd.concat([D, ext])
    idx = div.index.intersection(gold.index); idx = idx[idx >= pd.Period("1925-01", "M")]
    div = div[idx]; g = gold[idx] / GRAMS_PER_OZ
    ratio = div / g
    last = ratio.index[-1]
    return {"last_updated": now, "splice": str(D.index[-1]),
            "dates": [str(d) for d in idx], "div": [round(float(x), 3) for x in div.values],
            "ratio": [round(float(x), 4) for x in ratio.values],
            "levels": {"haut": 1.465, "milieu": 1.0, "moyen": 0.66, "bas": 0.459},
            "current": {"date": str(last), "ratio": float(ratio.iloc[-1]), "div": float(div.iloc[-1]),
                        "gold_g": float(g.iloc[-1]), "gold_oz": float(gold[last]),
                        "median": float(ratio.median()),
                        "pct_below": float((ratio < ratio.iloc[-1]).mean())}}

def build_rente(now, A):
    """Rente et profits en France : placements monétaires capitalisés (FR, DE) vs excédent brut des sociétés."""
    fr = fred("IR3TIB01FRM156N"); de = fred("IR3TIB01DEM156N")
    fr.index = fr.index.to_period("M"); de.index = de.index.to_period("M")
    k = pd.Period("1981-01", "M")
    def cap(r):
        r = r[r.index >= k]
        idx = (1 + r.shift(1).fillna(r.iloc[0]) / 1200).cumprod()
        return 100 * idx / idx.iloc[0]
    rfr, rde = cap(fr), cap(de)
    this_year = dt.date.today().year
    prof = A["FRA.1.0.0.0.UOGC"]
    prof = prof[(prof.index >= 1981) & (prof.index < this_year)]; prof = 100 * prof / prof[1981]
    ann = rfr.groupby(rfr.index.year).mean(); ann = 100 * ann / ann[1981]
    yrs = [y for y in prof.index if y in ann.index]
    ratio = pd.Series([ann[y] / prof[y] for y in yrs], index=yrs)
    var = (ratio.pct_change() * 100).dropna()
    un = A["FRA.1.0.0.0.ZUTN"]; un = un[(un.index >= 1981) & (un.index < this_year)]
    dun = un.diff().dropna()
    common = [y for y in var.index if y in dun.index]
    corr = float(np.corrcoef(var[common], dun[common])[0, 1]) if len(common) > 5 else None
    lagc = [y for y in var.index if y + 1 in dun.index]
    corr_lag = float(np.corrcoef(var[lagc], [dun[y + 1] for y in lagc])[0, 1]) if len(lagc) > 5 else None
    return {"last_updated": now,
            "rente_fr": {"dates": [str(d) for d in rfr.index], "v": [round(float(x), 2) for x in rfr.values]},
            "rente_de": {"dates": [str(d) for d in rde.index], "v": [round(float(x), 2) for x in rde.values]},
            "profits": {"years": [int(y) for y in prof.index], "v": [round(float(x), 2) for x in prof.values]},
            "ratio_var": {"years": [int(y) for y in var.index], "v": [round(float(x), 2) for x in var.values]},
            "chomage": {"years": [int(y) for y in un.index], "v": [round(float(x), 2) for x in un.values]},
            "current": {"rente_fr": float(rfr.iloc[-1]), "rente_de": float(rde.iloc[-1]), "rente_date": str(rfr.index[-1]),
                        "profits": float(prof.iloc[-1]), "profits_year": int(prof.index[-1]),
                        "var": float(var.iloc[-1]), "var_year": int(var.index[-1]),
                        "rente_fr_2002": float(rfr[pd.Period("2002-01", "M")]), "rente_de_2002": float(rde[pd.Period("2002-01", "M")]),
                        "profits_2002": float(prof[2002]), "corr": corr, "corr_lag": corr_lag}}

def build_exports(now):
    p = fetch("wb_merch_exports.json", "https://api.worldbank.org/v2/country/FRA;USA;OED/indicator/"
              "TX.VAL.MRCH.CD.WT?format=json&per_page=500&date=1960:2100")
    j = json.loads(p.read_text())[1]
    d = {}
    for x in j:
        if x["value"]: d.setdefault(x["countryiso3code"], {})[int(x["date"])] = x["value"]
    oed = pd.Series(d["OED"]).sort_index()
    out = {"last_updated": now, "series": {}}
    for c in ("FRA", "USA"):
        s = (pd.Series(d[c]).sort_index() / oed).dropna()
        out["series"][c] = {"years": [int(y) for y in s.index], "share": [round(float(x) * 100, 3) for x in s.values],
                            "base100": [round(float(x / s[1982] * 100), 2) for x in s.values]}
    f, u = out["series"]["FRA"], out["series"]["USA"]
    out["current"] = {"year": f["years"][-1], "fra_share": f["share"][-1], "fra_idx": f["base100"][-1],
                      "usa_share": u["share"][-1], "usa_idx": u["base100"][-1],
                      "fra_1982": f["share"][f["years"].index(1982)], "usa_1982": u["share"][u["years"].index(1982)],
                      "fra_2002": f["base100"][f["years"].index(2002)], "usa_2002": u["base100"][u["years"].index(2002)]}
    return out

# ---------------------------------------------------------------- articles de Charles Gave (Institut des Libertés)
def periods(flag, labels):
    """Découpe une série de codes mensuels en périodes continues [début, fin, code]."""
    out = []
    for d, v in flag.items():
        if out and out[-1][2] == v: out[-1][1] = str(d)
        else: out.append([str(d), str(d), v])
    return [{"start": a, "end": b, "code": c, "label": labels.get(c, c)} for a, b, c in out]

def monthly_fred(series):
    s = fred(series); s.index = s.index.to_period("M"); return s[~s.index.duplicated(keep="last")].sort_index()

def rnd(s, d=3): return [None if pd.isna(x) else round(float(x), d) for x in s.values]

QUAD = {"boom_defl": "Boom déflationniste", "bust_defl": "Bust déflationniste",
        "boom_infl": "Boom inflationniste", "bust_infl": "Bust inflationniste"}
QUAD_EXCL = {"boom_defl": ["or", "cash"], "bust_defl": ["actions", "or"],
             "boom_infl": ["obligations"], "bust_infl": ["obligations", "actions"]}
ASSETS = ["actions", "obligations", "or", "cash"]

def build_quadrants(now, gold, r17):
    """Les cycles longs (IDL, 19/02/2024) : inflation = l'or bat le cash ; croissance = les actions battent l'or.
    Hypothèse du site : « battre » = ratio au-dessus de sa moyenne mobile 7 ans (Gave ne précise pas le critère)."""
    tb = monthly_fred("TB3MS")
    last = gold.index[-1]
    full = pd.period_range(tb.index[0], last, freq="M")
    tbf = tb.reindex(full).ffill()  # derniers mois : dernier taux connu prolongé
    cash = (1 + tbf.shift(1).fillna(tbf.iloc[0]) / 1200).cumprod()
    idx = cash.index.intersection(gold.index).intersection(r17.index)
    rc = gold[idx] / cash[idx]; rc = 100 * rc / rc.iloc[0]
    ma = rc.rolling(MA_MONTHS).mean(); ma17 = r17.rolling(MA_MONTHS).mean().reindex(idx)
    ok = ma.notna() & ma17.notna()
    infl = (rc > ma)[ok]; growth = (r17.reindex(idx) > ma17)[ok]
    code = pd.Series(np.where(infl, np.where(growth, "boom_infl", "bust_infl"), np.where(growth, "boom_defl", "bust_defl")), index=infl.index)
    per = periods(code, QUAD)
    c = code.iloc[-1]; excl = QUAD_EXCL[c]
    return {"last_updated": now, "dates": [str(d) for d in idx], "ratio": rnd(rc, 4), "ma": rnd(ma, 4),
            "periods": per, "cash_last_rate_date": str(tb.index[-1]),
            "current": {"date": str(idx[-1]), "code": c, "label": QUAD[c], "since": per[-1]["start"],
                        "excluded": excl, "allowed": [a for a in ASSETS if a not in excl],
                        "inflation": bool(infl.iloc[-1]), "croissance": bool(growth.iloc[-1]),
                        "gold_cash": float(rc.iloc[-1]), "gold_cash_ma": float(ma.iloc[-1]),
                        "gold_cash_gap": float(rc.iloc[-1] / ma.iloc[-1] - 1),
                        "r17": float(r17.iloc[-1]), "r17_ma": float(ma17.iloc[-1]), "r17_gap": float(r17.iloc[-1] / ma17.iloc[-1] - 1),
                        "tb3": float(tb.iloc[-1])}}

def build_wicksell(now, yld):
    """Règle de Wicksell (IDL, 23/03/2026) : taux 10 ans US < croissance annuelle moyenne du PIB nominal sur 7 ans → or."""
    gdp = fred("GDP"); gdp.index = gdp.index.to_period("Q")
    g7 = ((gdp / gdp.shift(28)) ** (1 / 7) - 1) * 100
    g7 = g7.dropna()
    gm = pd.Series({p: v for q, v in g7.items() for p in pd.period_range(q.asfreq("M", "s"), q.asfreq("M", "e"), freq="M")})
    y = yld[yld.index >= gm.index[0]]
    gm = gm.reindex(y.index).ffill()  # derniers mois : dernière croissance publiée
    ok = gm.notna(); y, gm = y[ok], gm[ok]
    below = y < gm
    code = pd.Series(np.where(below, "or", "obligations"), index=y.index)
    per = periods(code, {"or": "or", "obligations": "obligations"})
    return {"last_updated": now, "dates": [str(d) for d in y.index], "taux": rnd(y, 3), "croissance": rnd(gm, 3),
            "periods": per, "gave_threshold": 5.9, "gdp_last": str(gdp.index[-1]),
            "current": {"date": str(y.index[-1]), "taux": float(y.iloc[-1]), "croissance": float(gm.iloc[-1]),
                        "ecart": float(y.iloc[-1] - gm.iloc[-1]), "signal": code.iloc[-1], "since": per[-1]["start"],
                        "gdp_quarter": str(gdp.index[-1])}}

def build_fr_bonds(now):
    """La loi de Gresham (IDL, 29/05/2023) : taux 10 ans français vs sa moyenne 7 ans, et rendement réel (10 ans − inflation)."""
    fr = monthly_fred("IRLTLT01FRM156N")
    ma = fr.rolling(MA_MONTHS).mean()
    above, ev = crossings(fr, ma, "au-dessus", "en dessous")
    cpi = monthly_fred("FRACPIALLMINMEI").pct_change(12) * 100  # IPC OCDE France (s'arrête en 2025)
    src = "IPC France (OCDE)"
    try:
        h = monthly_fred("CP0000FRM086NEST").pct_change(12) * 100  # IPCH France (Eurostat), pour prolonger
        cpi = pd.concat([cpi.dropna(), h[h.index > cpi.dropna().index[-1]].dropna()])

    except Exception as e: print("[WARN] IPCH France", e); h = None
    cpi = cpi.dropna(); cpi_split = None
    if h is not None:
        o = monthly_fred("FRACPIALLMINMEI").pct_change(12).dropna()
        cpi_split = str(o.index[-1])
    idx = fr.index.intersection(cpi.index); idx = idx[idx >= pd.Period("1970-01", "M")]
    real = fr[idx] - cpi[idx]
    r = float(real.iloc[-1])
    if r >= 5: st = "acheter"
    elif r >= 2: st = "neutre"
    elif r >= 1: st = "commencer_vendre"
    else: st = "tout_vendre"
    return {"last_updated": now, "dates": [str(d) for d in fr.index], "taux": rnd(fr, 3), "ma": rnd(ma, 3), "events": ev,
            "real": {"dates": [str(d) for d in idx], "v": rnd(real, 3), "infl": rnd(cpi[idx], 3)},
            "cpi_split": cpi_split, "levels": {"acheter": 5, "commencer_vendre": 2, "tout_vendre": 1, "moyenne_gave": 2},
            "current": {"date": str(fr.index[-1]), "taux": float(fr.iloc[-1]), "ma": float(ma.iloc[-1]),
                        "above": bool(above.iloc[-1]), "since": ev[-1]["date"] if ev else None,
                        "gap_pct": float(fr.iloc[-1] / ma.iloc[-1] - 1),
                        "real_date": str(idx[-1]), "real": r, "infl": float(cpi[idx[-1]]), "taux_real_date": float(fr[idx[-1]]),
                        "real_status": st, "real_mean": float(real.mean()), "real_mean_from": str(idx[0])}}

def build_gold_overbought(now, gold, thr=0.65):
    """Or « suracheté » (IDL, 23/03/2026) : hausse de 65 % ou plus sur 12 mois."""
    yoy = gold.pct_change(12).dropna(); yoy = yoy[yoy.index >= pd.Period("1971-01", "M")]
    flag = yoy >= thr
    per = [p for p in periods(pd.Series(np.where(flag, "sur", "non"), index=yoy.index), {}) if p["code"] == "sur"]
    k = yoy.index[-1]
    return {"last_updated": now, "dates": [str(d) for d in yoy.index], "v": rnd(yoy * 100, 2), "threshold": thr * 100,
            "periods": per,
            "current": {"date": str(k), "yoy": float(yoy.iloc[-1]), "alert": bool(flag.iloc[-1]),
                        "gold": float(gold[k]), "gold_12m": float(gold[k - 12]),
                        "max_12m": float(yoy[yoy.index > k - 12].max()), "max_12m_date": str(yoy[yoy.index > k - 12].idxmax())}}


def build_macro(now, sh=None, gold=None):
    res = {}
    this_year = dt.date.today().year
    try:
        A = ameco()
        # Dette publique (% PIB) — France + comparaisons
        debt = {}
        for c in ("FRA", "GBR", "NLD", "DEU"):
            s = A.get(f"{c}.1.0.319.0.UDGGL")
            if s is not None and len(s):
                debt[c] = {"years": [int(y) for y in s.index], "v": [round(float(x), 1) for x in s.values]}
        dq = []
        try: dq = eurostat_q_debt("FR")
        except Exception as e: print("[WARN] eurostat debt", e)
        fr = A["FRA.1.0.319.0.UDGGL"]; fr_act = fr[fr.index < this_year]
        res["dette"] = {"last_updated": now, "forecast_from": this_year, "series": debt, "fr_quarterly": dq,
                        "current": {"year": int(fr_act.index[-1]), "v": float(fr_act.iloc[-1]),
                                    "first_year": int(fr.index[0]), "first_v": float(fr.iloc[0]),
                                    "q": dq[-1] if dq else None}}
        # Dépenses publiques en volume vs PIB en volume
        sp = {}
        for c in ("FRA", "GBR", "NLD"):
            gdp, defl = A[f"{c}.1.1.0.0.OVGD"], A[f"{c}.3.1.0.0.PVGD"]
            cons = (A[f"{c}.1.0.0.0.UCTG"] / defl * 100).dropna()
            item = {"years": [int(y) for y in gdp.index], "pib": [round(float(x), 3) for x in gdp.values],
                    "conso": {"years": [int(y) for y in cons.index], "v": [round(float(x), 3) for x in cons.values]}}
            tot = A.get(f"{c}.1.0.0.0.UUTG")
            if tot is not None:
                tot = (tot / defl * 100).dropna()
                # AMECO ne publie la dépense totale britannique que pour les années de prévision : on l'écarte
                tot = tot[tot.index < this_year]
                if len(tot) >= 10:
                    item["total"] = {"years": [int(y) for y in tot.index], "v": [round(float(x), 3) for x in tot.values]}
            share = A.get(f"{c}.1.0.319.0.UUTG")
            if share is not None:
                share = share[share.index < this_year]
                if len(share): item["total_pct_pib"] = {"year": int(share.index[-1]), "v": float(share.iloc[-1])}
            sp[c] = item
        res["depenses"] = {"last_updated": now, "forecast_from": this_year, "countries": sp}
        try: res["rente"] = build_rente(now, A)
        except Exception as e: print("[WARN] rente", e)
    except Exception as e: print("[WARN] AMECO", e)
    try:
        def splice(kind):
            de, xm = bis_eer(kind, "DE"), bis_eer(kind, "XM")
            k = pd.Period("1999-01", "M")
            xm = xm[xm.index >= k] * (de[k] / xm[k])
            s = pd.concat([de[de.index < k], xm]); return 100 * s / s[pd.Period("1990-10", "M")]
        n, r = splice("N"), splice("R")
        peak = n[(n.index >= pd.Period("1990-10", "M")) & (n.index < pd.Period("1999-01", "M"))]
        res["change"] = {"last_updated": now,
            "nominal": {"dates": [str(d) for d in n.index], "v": [round(float(x), 2) for x in n.values]},
            "reel": {"dates": [str(d) for d in r.index], "v": [round(float(x), 2) for x in r.values]},
            "current": {"date": str(n.index[-1]), "nominal": float(n.iloc[-1]), "reel": float(r.iloc[-1]),
                        "yoy": float(n.iloc[-1] / n.iloc[-13] - 1),
                        "dm_peak_date": str(peak.idxmax()), "dm_peak": float(peak.max()),
                        "euro_low_date": str(n[n.index >= pd.Period("1999-01", "M")].idxmin()),
                        "euro_low": float(n[n.index >= pd.Period("1999-01", "M")].min())}}
    except Exception as e: print("[WARN] BIS", e)
    try: res["export"] = build_exports(now)
    except Exception as e: print("[WARN] exports", e)
    if sh is not None:
        try: res["g23"] = build_dividends_gold(now, sh, gold)
        except Exception as e: print("[WARN] g23", e)
    return res

def main():
    now = dt.datetime.now().astimezone().isoformat(timespec="minutes")
    sh = shiller()
    gold = gold_monthly(); spx = sp500_tr(sh); yld = bond_yield(sh); bnd = bond_tr(yld)
    out = {"last_updated": now}

    # Graphique 15 : or / obligations US, base 100 au 1/1/1972
    idx = gold.index.intersection(bnd.index); idx = idx[idx >= pd.Period("1972-01", "M")]
    r15 = gold[idx] / bnd[idx]; r15 = 100 * r15 / r15.iloc[0]
    # Comme dans le livre, la moyenne démarre en 1972 : moyenne des mois disponibles (au moins 12) jusqu'en 1978, puis vraie moyenne 7 ans.
    g15 = build_rule(r15, "or", "obligations", gold.pct_change(), bnd.pct_change(), min_periods=12)
    g15["partial_ma_until"] = str(r15.index[MA_MONTHS - 1])
    g15["last_updated"] = now
    # Graphique 17 : S&P 500 dividendes réinvestis / or, base 100 au 1/1/2000
    idx = gold.index.intersection(spx.index); idx = idx[idx >= pd.Period("1900-01", "M")]
    r17 = spx[idx] / gold[idx]; r17 = 100 * r17 / r17[pd.Period("2000-01", "M")]
    g17 = build_rule(r17, "actions", "or", spx.pct_change(), gold.pct_change())
    g17["last_updated"] = now
    out["g15"] = g15; out["g17"] = g17

    # Bonus 1 : profits des entreprises US vs emploi (glissement annuel)
    try:
        cp = fred("CP"); pay = fred("PAYEMS")
        cpy = (cp.pct_change(4) * 100).dropna(); py = (pay.pct_change(12) * 100).dropna()
        cpy = cpy[cpy.index >= "1960-01-01"]; py = py[py.index >= "1960-01-01"]
        out["profits"] = {"last_updated": now,
            "profits": {"dates": [d.strftime("%Y-%m-%d") for d in cpy.index], "v": [round(x, 2) for x in cpy]},
            "profits_lead9": {"dates": [(d + pd.DateOffset(months=9)).strftime("%Y-%m-%d") for d in cpy.index], "v": [round(x, 2) for x in cpy]},
            "emploi": {"dates": [d.strftime("%Y-%m-%d") for d in py.index], "v": [round(x, 2) for x in py]},
            "current": {"profits_date": cpy.index[-1].strftime("%Y-%m"), "profits": float(cpy.iloc[-1]),
                        "emploi_date": py.index[-1].strftime("%Y-%m"), "emploi": float(py.iloc[-1])}}
    except Exception as e: print("[WARN] profits", e)

    # Bonus 2 : CAC 40 en dollars / S&P 500 (indices de prix, hors dividendes)
    try:
        cac = to_month(yahoo("^FCHI", "1mo", "max")); spxp = to_month(yahoo("^GSPC", "1mo", "max"))
        fx = fred("EXUSEU"); fx.index = fx.index.to_period("M")
        try:
            fxd = to_month(yahoo("EURUSD=X", "1d", "3mo")); fx = pd.concat([fx, fxd[fxd.index > fx.index[-1]]])
        except Exception as e: print("[WARN] EURUSD", e)
        idx = cac.index.intersection(spxp.index).intersection(fx.index)
        rc = cac[idx] * fx[idx] / spxp[idx]; rc = 100 * rc / rc.iloc[0]
        ma = rc.rolling(MA_MONTHS).mean(); above, ev = crossings(rc, ma, "CAC", "S&P")
        out["cac"] = {**series_json(rc, ma), "events": ev, "last_updated": now,
                      "current": {"date": str(rc.index[-1]), "ratio": float(rc.iloc[-1]), "ma": float(ma.iloc[-1]),
                                  "above": bool(above.iloc[-1]), "since": ev[-1]["date"] if ev else None}}
    except Exception as e: print("[WARN] cac", e)

    # Articles de l'Institut des Libertés : quadrants, Wicksell, obligations françaises, or suracheté
    for key, fn in (("quadrants", lambda: build_quadrants(now, gold, r17)), ("wicksell", lambda: build_wicksell(now, yld)),
                    ("frbonds", lambda: build_fr_bonds(now)), ("surachat", lambda: build_gold_overbought(now, gold))):
        try: out[key] = fn()
        except Exception as e: print(f"[WARN] {key}", e)

    out.update(build_macro(now, sh, gold))
    # Repli : un bloc qui n'a pas pu être recalculé garde sa dernière version publiée (data/<clé>.json)
    for k in ("g23", "profits", "cac", "dette", "depenses", "change", "rente", "export", "quadrants", "wicksell", "frbonds", "surachat"):
        if k not in out and (DATA / f"{k}.json").exists():
            try:
                out[k] = json.loads((DATA / f"{k}.json").read_text()); out[k]["stale"] = True
                print(f"[WARN] {k}: données précédentes conservées")
            except Exception as e: print(f"[WARN] {k} repli", e)
    out["sources"] = STATUS
    for k, v in out.items():
        if isinstance(v, dict): (DATA / f"{k}.json").write_text(json.dumps(v, ensure_ascii=False))
    (DATA / "meta.json").write_text(json.dumps({"last_updated": now}, ensure_ascii=False))
    # bundle JS pour pouvoir ouvrir index.html directement (file://) sans serveur
    (DATA / "bundle.js").write_text("window.GAVE_DATA=" + json.dumps(out, ensure_ascii=False) + ";")
    for k in ("g15", "g17"):
        c = out[k]["current"]; print(k, c, out[k]["backtest"])
    print("événements g15:", [e["date"] + "→" + e["to"] for e in g15["events"]])
    print("événements g17:", [e["date"] + "→" + e["to"] for e in g17["events"]])

if __name__ == "__main__":
    main()
