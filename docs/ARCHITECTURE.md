# Architecture

```
Navigateur ──HTTPS──▶ Vercel
   │                    ├─ fichiers statiques  (client/)       CSP + en-têtes via vercel.json
   │                    └─ /api/*  → fonction  api/index.js     Express (server/src)
   │                                             │      │
   │                                             │      └──▶ Neon (PostgreSQL via Prisma + adapter-pg)
   │                                             └─────────▶ R2 : URLs signées (courte durée)
   └──── PUT/GET direct par URL signée ───────────────────▶ Cloudflare R2 (bucket PRIVÉ)
```

Les octets des fichiers **ne transitent jamais par la fonction** (limites de taille et de durée du serverless) : l'API autorise, le navigateur envoie directement au stockage, puis l'API **vérifie** le résultat.

## Flux d'envoi

1. `POST /files/uploads` : contrôle nom/extension/taille/quota, réserve l'espace (verrou `FOR UPDATE`), crée la ligne `UPLOADING`, renvoie une URL signée (fichier simple) ou le plan en parties (multipart, 8 Mo par partie).
2. Le navigateur envoie directement au stockage (2 fichiers en parallèle, 3 parties en parallèle, 3 essais par partie).
3. `POST /files/:id/complete` : le serveur compte les parties (`ListParts`), vérifie taille, signature du contenu, calcule le SHA-256 puis passe en `READY`. Échec : fichier supprimé et espace rendu.
4. Reprise : `GET /files/:id/upload` liste les parties déjà reçues.
5. Les envois abandonnés sont nettoyés par la tâche planifiée.

## Modules serveur

| Module | Rôle |
|---|---|
| `config/env.js` | Lecture et validation de l'environnement ; refuse une configuration de production dangereuse |
| `config/policy.js` | Table des formats, vérification de signature, assainissement des noms |
| `services/access.js` | **Seul** endroit qui décide des droits (propriétaire, partage personne, lien) ; ressource inaccessible = 404 |
| `services/files.js`, `folders.js`, `tree.js` | Fichiers, dossiers (CTE récursive, profondeur max 20, anti-cycle), corbeille |
| `services/shares.js` | Liens (jeton haché) et partages par e-mail, révocation |
| `services/geo.js` | Validation/assainissement GeoJSON, conversion KML sans DTD |
| `services/cleanup.js` | Purge de la corbeille (30 j), envois abandonnés, sessions expirées |
| `storage/{local,r2}.js` | Même interface : URL signées, multipart, `head`, suppression |
| `middleware/*` | En-têtes/CSP, CORS strict, limitation de débit, session, CSRF, validation Zod |

## Données (Prisma)

`User`, `Session`, `PasswordResetToken`, `Folder`, `FileAsset`, `ShareLink`, `ShareGrant`, `AuditLog`, `RateLimit`. Aucun binaire en base. Les jetons (session, lien, réinitialisation) sont stockés **hachés**. Contraintes SQL : un partage cible exactement un fichier ou un dossier, quotas ≥ 0.

## Front

Application monopage sans framework : routeur par fragment (`#/files/<id>`), modules chargés à la demande, construction du DOM par `h()` (jamais de HTML en chaîne). Pages publiques (accueil, connexion, partage) séparées de l'application connectée.

## Évolutions prévues (après le MVP)

Un **worker** (service séparé, hors Vercel : petite VM ou conteneur) lirait une file de tâches en base (`SecurityStatus`/`PreviewStatus` existent déjà) pour : analyse ClamAV, extraction sûre de métadonnées, conversion en tuiles/GeoJSON des Shapefiles et GeoTIFF. Le MVP n'en dépend pas.
