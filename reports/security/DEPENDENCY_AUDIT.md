# Audit des dépendances

Date : 2026-10-24. Outil : `npm audit` (base d'avis de sécurité du registre npm), version npm de l'environnement de build.

| Périmètre | Commande | Résultat |
|---|---|---|
| Production | `npm audit --omit=dev` | 0 vulnérabilité |
| Tout (dev inclus, avec les outils de test navigateur) | `npm audit` | 0 vulnérabilité |

Sortie brute : `raw/npm-audit-prod.json` (248 dépendances de production, 182 de développement).

Dépendances directes de production (11) : express 5.3, helmet 8.3, zod 4.6, pg 8.23, @prisma/client et @prisma/adapter-pg 7.10, @node-rs/argon2 2.2, @aws-sdk/client-s3 et s3-request-presigner 3.1156, @tmcw/togeojson 7.1, @xmldom/xmldom 0.9.

## Limites de cet audit

- `npm audit` ne connaît que les avis déjà publiés : « 0 vulnérabilité » ne veut pas dire « aucune faille ».
- Il ne vérifie pas la chaîne d'approvisionnement (paquets malveillants, compromission de mainteneur). Le fichier `package-lock.json` est fourni : installer avec `npm ci`.
- Le résultat est daté ; il doit être rejoué à chaque mise à jour (la CI exécute `npm run audit:deps`) et activer Dependabot ou Renovate est recommandé.
- Leaflet (bibliothèque front auto-hébergée dans `client/assets/vendor`) est copiée depuis `node_modules` : les avis la concernant sont couverts par `npm audit` tant qu'elle reste dans le lockfile.
