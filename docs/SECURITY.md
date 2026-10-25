# Sécurité : conception

Complète `reports/security/SECURITY_BASELINE.md` (ce qui est vérifié) et `docs/THREAT_MODEL.md`.

## Règles de développement

1. **Un seul module décide des droits** (`services/access.js`). Toute route qui touche une ressource passe par lui. Ressource d'autrui = 404.
2. **Aucune donnée utilisateur n'est du HTML** : le front construit le DOM par `h()` / `textContent`. ESLint interdit `innerHTML` et consorts.
3. **Aucun secret dans le code ni dans le front.** `.env` est ignoré par Git ; la configuration de production refuse les valeurs d'exemple.
4. **Les jetons ne sont jamais stockés en clair** (session, lien de partage, réinitialisation) ; les IP ne sont stockées que sous forme de HMAC.
5. **Les octets passent par des URL signées courtes** (5 min téléchargement, 15 min envoi) et le bucket reste privé.
6. **Validation stricte des entrées** (Zod `.strict()` : champs inconnus refusés), requêtes SQL paramétrées (Prisma ; `$queryRaw` en gabarits étiquetés uniquement).
7. **On ne dit jamais plus que ce qu'on a vérifié** : pas d'antivirus → pas de mention « sain ».

## Secrets à fournir (Vercel → Settings → Environment Variables)

`APP_SECRET` (≥ 32 caractères aléatoires), `CRON_SECRET` (≥ 32), `DATABASE_URL`, `DIRECT_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, éventuellement `UPSTASH_*`. Créer la clé R2 avec un accès limité à ce seul bucket (lecture/écriture objets).

## Rotation

`APP_SECRET` : sa rotation invalide les URL de stockage local et change le HMAC des IP (le journal perd la corrélation avec l'ancien) ; les sessions ne sont pas concernées (jetons aléatoires hachés). Clés R2 : créer la nouvelle, mettre à jour Vercel, redéployer, supprimer l'ancienne.

## Signaler une faille

À définir par le propriétaire du projet (adresse de contact, éventuellement `/.well-known/security.txt`).
