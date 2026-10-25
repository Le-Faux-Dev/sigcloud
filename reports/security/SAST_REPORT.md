# Analyse statique (SAST)

Date : 2026-10-24. Outil : **semgrep 1.182.1** (OSS), règles **locales** issues du dépôt officiel `semgrep/semgrep-rules` (commit `16b9e6d`, 2026-10-21) : dossiers `javascript/` et `generic/secrets/`. Le registre semgrep.dev était inaccessible depuis l'environnement ; les règles ont été clonées depuis GitHub.

Périmètre : `server/`, `client/scripts/`, `api/`, `scripts/` (67 fichiers analysés, 394 règles exécutées). Sortie brute : `raw/semgrep.json`.

Contrôles complémentaires (ESLint, `npm run lint`) : `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` sont **interdits en erreur** dans `client/scripts/` ; 0 erreur. `scripts/check-html.mjs` : aucun script, style ni gestionnaire d'événement en ligne dans les 8 pages.

## Résultats : 6 détections initiales, toutes examinées

| # | Règle | Fichier | Verdict | Action |
|---|---|---|---|---|
| 1 | unsafe-dynamic-method | `client/scripts/app.js` (routeur) | **Vrai positif mineur** : `VIEWS[key]` avec `key` venant de l'URL ; `#/constructor` aurait atteint un objet inattendu (erreur affichée, pas d'exécution de code). | **Corrigé** : `Object.hasOwn(VIEWS, key)`. |
| 2 | html-in-template-string | `scripts/build-contours.mjs` (×2) | Faux positif : génération d'un SVG au build à partir de nombres calculés, aucune donnée utilisateur. | Accepté. |
| 3 | html-in-template-string | `scripts/build-icons.mjs` | Faux positif : assemblage du sprite depuis `lucide-static` au build. | Accepté. |
| 4 | cors-misconfiguration | `server/src/middleware/security.js` | Faux positif : l'origine n'est reflétée que si elle est **strictement égale** à `APP_ORIGIN` ; jamais de `*`. | Accepté (test d'intégration dédié). |
| 5 | detect-redos | `server/src/storage/local.js` (`KEY_RE`) | Faux positif : segments séparés par `/` obligatoire, pas d'ambiguïté. Mesuré : 60 000 caractères en < 1 ms. La clé est de toute façon générée par le serveur. | Accepté. |

Après correction : 5 détections restantes, toutes classées faux positifs ci-dessus. Une erreur d'analyse partielle (`build-icons.mjs` ligne 27, syntaxe regex non comprise par l'analyseur) n'affecte que ce script de build.

## Limites

- Un SAST à règles génériques ne comprend pas la logique métier (droits d'accès, IDOR, quotas). Ces points sont couverts par les tests d'intégration (`server/tests/integration/security.test.js`, `sharing.test.js`), pas par semgrep.
- Pas de règles semgrep « pro » ni d'analyse inter-fichiers (flux de données) : le jeu de règles OSS est limité.
- Pas de test d'intrusion ni de revue indépendante.
