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

Articles de l'Institut des Libertés (2023–2026) :
- **Quadrants inflation / croissance** (« Les cycles longs… ») : or / cash (TB3MS capitalisé) et actions / or, chacun
  contre sa moyenne mobile 7 ans. La moyenne 7 ans est **une hypothèse du site** : Gave ne donne pas le critère.
- **Règle de Wicksell** : 10 ans US (GS10/^TNX) contre croissance annuelle moyenne du PIB nominal US sur 7 ans (FRED GDP) ;
  taux < croissance → or. Seuil de vente de l'or cité par Gave : 10 ans ≥ 5,9 %.
- **Obligations françaises** (« La loi de Gresham… ») : taux 10 ans (FRED IRLTLT01FRM156N) contre moyenne 7 ans, et rendement
  réel = taux − inflation sur 12 mois (IPC OCDE FRACPIALLMINMEI, puis IPCH CP0000FRM086NEST après mars 2025). Seuils 5 / 2 / 1 %.
- **Or suracheté** : hausse de l'or ≥ 65 % sur 12 mois → « Avertissement » (repli technique probable), pas un signal de vente.

## Bulles d'information
Au survol (souris) ou en touchant le graphique (mobile, appui simple ou appui long en glissant), une bulle affiche
la date exacte (mois, trimestre ou année) et les valeurs avec leurs unités. Sur écran tactile, le zoom par glissement
est désactivé pour que le doigt serve à lire les valeurs ; un petit gestionnaire (`addTouchHover` dans app.js)
garde la bulle affichée après le relâchement. Vérifié avec Playwright (contexte mobile hasTouch) : 13/13 graphiques.

## Navigation dans les graphiques
Au-dessus de chaque graphique, une barre d'outils (fonctions `ensureWrap`, `initView`, `applyPeriod`… dans app.js) :
- **Périodes** : 6 mois, 1 an, 5, 10, 20 ans pour les séries mensuelles ; 10, 20, 30 ans pour les séries annuelles ; « Tout ».
  Les boutons sont calculés à partir de la fin réelle des données. Un bouton n'apparaît que si la fenêtre contient au moins
  6 points (les boutons 1 mois et 3 mois existent mais sont masqués : aucune série du site n'est journalière ou hebdomadaire).
  L'échelle verticale est recalée sur la période affichée.
- **＋ / －** (zoom centré, ancré sur le dernier point quand la vue touche la fin des données), **Déplacer** (le doigt ou la
  souris fait glisser la période ; l'axe vertical suit), **Réinitialiser** (ou double-clic / double appui) = vue complète.
- **Plein écran** : API Fullscreen, avec repli sur un calque CSS plein écran (iPhone). Échap ou « ✕ Fermer » pour sortir.
  Sur ordinateur, la molette zoome seulement en plein écran ; ailleurs elle fait défiler la page.
- Sur mobile, hors mode « Déplacer », un glissement vertical fait défiler la page (`touch-action: pan-y`) et le doigt affiche la bulle.

## Tableau des signaux
En haut de la page, recalculé depuis `data/*.json` à chaque chargement : valeur, référence de la règle, écart, statut et actif
désigné. Règles chiffrées : graphiques 15 et 17 (ratio vs moyenne 7 ans) et 23 (seuils 0,459 g et 1,465 g). Les autres
indicateurs sont « Indéfini / contexte ». S'y ajoutent les quadrants, Wicksell, les deux règles sur les obligations françaises
et l'alerte « or suracheté ». Le cash est désigné par le quadrant (bust déflationniste ou inflationniste) ; une règle sans seuil
atteint (graphique 23) renvoie au quadrant. Sans données de quadrant, on revient au statut « Cash / prudence (par défaut) ».

## Robustesse des téléchargements
`fetch()` : délais courts (8 s connexion, 30 s lecture), 2 essais ; un serveur qui expire est marqué « hors service » pour le
reste du run et ses séries sont lues dans `cache/`. Un bloc qui ne peut pas être recalculé garde son `data/<clé>.json` précédent
(champ `stale: true`).
