# Déploiement : Vercel + Neon + Cloudflare R2

> Points non testés dans mon environnement : R2, Vercel, `prisma migrate`. Chaque étape a donc une vérification. Les limites gratuites changent : relis les pages de tarification de chaque service le jour J.

## 1. Neon (PostgreSQL)

1. Crée un projet, une base `sigcloud`.
2. Copie **deux** URL : la **poolée** (host avec `-pooler`) → `DATABASE_URL` ; la **directe** → `DIRECT_URL` (migrations).
3. Depuis ton poste : `DIRECT_URL=… DATABASE_URL=… npx prisma migrate deploy`. Vérifie : `npx prisma migrate status`.

## 2. Cloudflare R2

1. Crée un bucket **privé** (`sig-cloud-private`). Ne l'expose pas (pas de domaine public, pas de `r2.dev`).
2. Crée un jeton d'API R2 limité à ce bucket (lecture + écriture d'objets) → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` ; note `R2_ACCOUNT_ID`.
3. **CORS du bucket** (indispensable : le navigateur envoie directement) :

```json
[
  {
    "AllowedOrigins": ["https://TON-DOMAINE.vercel.app"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ExposeHeaders: ETag` est obligatoire pour l'envoi en parties. Remplace l'origine par ton domaine exact (jamais `*`).
4. Règle de cycle de vie conseillée : abandonner les envois multipart incomplets après 1 jour.

## 3. Vercel

1. Importe le dépôt. Framework : « Other ». Les réglages viennent de `vercel.json` (build `npm run build`, sortie `client`, fonction `api/index.js`, réécriture `/api/*`, cron quotidien).
2. Variables d'environnement (Production) :

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | `https://TON-DOMAINE.vercel.app` (https obligatoire) |
| `TRUST_PROXY` | `1` |
| `APP_SECRET`, `CRON_SECRET` | 48 octets aléatoires chacun : `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `DATABASE_URL`, `DIRECT_URL` | URL Neon (poolée / directe) |
| `STORAGE_DRIVER` | `r2` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | issus de l'étape 2 |
| `RATE_LIMIT_STORE` | `postgres` (ou `upstash` avec `UPSTASH_REDIS_REST_URL` et `_TOKEN`) |
| `MAIL_DRIVER` | `none` (la réinitialisation par e-mail est alors désactivée) |

L'application **refuse de démarrer** en production avec le stockage local, le limiteur en mémoire, un `APP_ORIGIN` non https ou des secrets d'exemple.
3. Déploie, puis vérifie dans l'ordre :
   - `GET https://…/api/v1/health` → `{"ok":true}` (sinon : la réécriture `/api` est en cause) ;
   - inscription, puis `npm run create-admin -- ton@email.com` (avec les variables de production) ;
   - envoi d'un petit fichier puis d'un fichier > 8 Mo ; téléchargement ; aperçu carte ;
   - `curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/v1/cron/cleanup` → `{"ok":true,…}`.

## 4. Exploitation

- **Sauvegardes** : Neon conserve un historique de restauration limité selon l'offre ; ajoute une sauvegarde `pg_dump` régulière. Active le versionnage du bucket si tu veux annuler des suppressions définitives.
- **Retour arrière** : Vercel → Deployments → « Promote to Production » sur le déploiement précédent. Les migrations sont additives : n'écris jamais de migration destructive sans plan de retour.
- **Surveillance** : journaux de la fonction Vercel (JSON sans secrets), tableau « Administration » (envois refusés, événements).
- **Limites à surveiller** : durée max de la fonction (30 s configurés), connexions Neon (`DB_POOL_MAX=5` par instance), stockage R2, appels du cron.

## 5. Plan du worker (après le MVP)

Service séparé (VM ou conteneur gratuit/peu coûteux) qui lit les fichiers `securityStatus = PENDING` ou `previewStatus = PENDING`, exécute ClamAV, convertit les Shapefiles/GeoTIFF, et écrit les résultats en base. L'API ne change pas ; seuls les statuts évoluent.
