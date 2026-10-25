# Recherche de secrets

Date : 2026-10-24.

## Outil

**Gitleaks n'a pas pu être utilisé** : son téléchargement était bloqué dans l'environnement de build (accès réseau restreint). À la place :

1. `scripts/scan-secrets.mjs` (écrit pour ce projet, `npm run scan:secrets`) : cherche clés privées, clés AWS/R2 (`AKIA…`), jetons GitHub/Slack/Stripe live, JWT, URL de base de données avec mot de passe non fictif, affectations `secret|token|api_key|password = "<24+ caractères>"`, et la présence d'un fichier `.env` dans l'arbre.
2. Règles `generic/secrets` du dépôt officiel semgrep-rules (voir SAST_REPORT.md).

## Résultats

| Contrôle | Résultat |
|---|---|
| `scan-secrets.mjs` : 97 fichiers analysés (hors `node_modules`, `reports`, `vendor`) | Aucune détection |
| semgrep `generic/secrets` | Aucune détection |
| Fichier `.env` dans l'arbre livré | Aucun (`.gitignore` exclut `.env*` sauf `.env.example`) |

Sortie brute : `raw/secrets-scan.txt`.

Une première exécution avait signalé le mot de passe fictif des tests (`server/tests/helpers.js`) : faux positif, désormais marqué `secret-scan: ignore`. Toutes les valeurs de `.env.example` sont fictives (`CHANGE_ME…`).

## Limites

- Il s'agit de recherches par motifs, moins complètes que Gitleaks/TruffleHog (pas de détection par entropie, pas d'analyse de l'historique Git : le projet livré n'a pas d'historique).
- Si tu publies sur GitHub : active le « secret scanning » de GitHub et lance Gitleaks sur l'historique réel avant le premier push public.
- Si un secret réel a déjà été collé ailleurs (discussion, capture d'écran), considère-le compromis et fais-le tourner.
