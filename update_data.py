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

def fetch(name, url, binary=False, tries=4):
    path = CACHE / name
    err = None
    for i in range(tries):
        try:
            r = requests.get(url, headers=UA, timeout=60)
            r.raise_for_status()
            if len(r.content) < 200: raise ValueError("réponse trop courte")
            path.write_bytes(r.content)
            STATUS[name] = {"url": url, "ok": True, "cache": False}
            return path
        except Exception as e:
            err = e; time.sleep(2 * (i + 1))
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

    out.update(build_macro(now, sh, gold))
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
