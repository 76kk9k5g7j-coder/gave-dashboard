# Tableau de bord « règles de Charles Gave »

Site statique (HTML + Plotly en local) + script Python de mise à jour des données.

- Lancer : `./run.sh` (crée le venv si besoin, met à jour les données, sert sur http://localhost:8000)
- Ou sans serveur : `.venv/bin/python update_data.py` puis ouvrir `index.html` (les données sont aussi dans `data/bundle.js`).
- Hébergement statique : publier index.html, app.js, style.css, assets/, data/.

## Publication GitHub (mise à jour automatique)
Le workflow `.github/workflows/update-and-deploy.yml` tourne chaque samedi à 08:00 UTC, à chaque push sur `main`
et à la demande (onglet Actions → « Run workflow »). Il met à jour `data/`, commite les changements et publie le site
sur la branche `gh-pages` (GitHub Pages : Settings → Pages → Source « Deploy from a branch », branche `gh-pages`, dossier `/`).
Si une source est indisponible, les dernières données commitées restent publiées.

## Mise à jour hebdomadaire locale (cron)
    # tous les samedis à 8h (heure de Paris)
    0 8 * * 6 cd /workspace/gave-dashboard && .venv/bin/python -W ignore update_data.py >> update.log 2>&1

Le script est idempotent. Les fichiers bruts sont en cache dans cache/ et réutilisés si une source échoue
(l'état est visible dans data/sources.json et dans la section « Méthodologie & limites »).
Sources : Shiller, FRED, Yahoo, datasets/gold-prices, AMECO (zip ~7 Mo), Eurostat, BRI (stats.bis.org), Banque mondiale (API v2).

## Graphiques
Graphique 15 (or/obligations), Graphique 17 (actions/or), Graphique 23 (dividendes S&P 500 en grammes d'or),
profits/emploi US, CAC/S&P, dette France, dépenses publiques vs PIB (FR/UK/NL), change DM/euro,
rente et profits en France (base 1981), parts de marché à l'export France/USA (base 1982).

## Bulles d'information
Au survol (souris) ou en touchant le graphique (mobile, appui simple ou appui long en glissant), une bulle affiche
la date exacte (mois, trimestre ou année) et les valeurs avec leurs unités. Sur écran tactile, le zoom par glissement
est désactivé pour que le doigt serve à lire les valeurs ; un petit gestionnaire (`addTouchHover` dans app.js)
garde la bulle affichée après le relâchement. Vérifié avec Playwright (contexte mobile hasTouch) : 13/13 graphiques.
