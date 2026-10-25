# API (v1)

Base : `/api/v1`. JSON uniquement. Authentification : cookie de session HttpOnly. Toute écriture (POST/PATCH/PUT/DELETE) exige l'en-tête `X-CSRF-Token` (valeur renvoyée par `GET /auth/me` ou à la connexion) et un en-tête `Origin` égal à `APP_ORIGIN`. Les routes publiques de partage utilisent `X-Share-Token`.

Erreurs : `{ "error": { "code": "…", "message": "…", "details": {…}, "requestId": "…" } }`. Statuts : 400/422 validation, 401 non connecté, 403 interdit, **404 aussi pour une ressource d'autrui**, 409 conflit, 429 limite de débit.

## Authentification

| Méthode et chemin | Rôle |
|---|---|
| POST `/auth/register` `{email,password,displayName}` | Crée le compte et ouvre la session (limite : 5/heure/IP) |
| POST `/auth/login` `{email,password}` | Connexion (limites par IP et par compte) |
| POST `/auth/logout` | Ferme la session |
| GET `/auth/me` | Utilisateur courant + jeton CSRF |
| PATCH `/auth/me` `{displayName}` | Profil |
| POST `/auth/change-password` | Change le mot de passe (ferme les autres sessions) |
| GET `/auth/sessions`, DELETE `/auth/sessions/:id` | Appareils connectés |
| POST `/auth/password-reset/request`, `/confirm` | Réinitialisation (réponse identique que le compte existe ou non ; nécessite un service d'e-mail) |
| GET `/auth/export` | Export JSON des données du compte |
| DELETE `/auth/me` `{password}` | Supprime le compte et ses fichiers |

## Fichiers

| Méthode et chemin | Rôle |
|---|---|
| POST `/files/uploads` `{name,size,folderId?}` | Réserve l'envoi ; renvoie `upload` (simple ou parties) |
| POST `/files/:id/upload/parts` `{partNumbers}` | URL signées pour des parties (≤ 50) |
| GET `/files/:id/upload` | Parties déjà reçues (reprise) |
| POST `/files/:id/complete` | Vérifie et finalise |
| DELETE `/files/:id/upload` | Annule |
| GET `/files?folderId=root\|all\|<id>&q&category&ext&preview&sort&order&limit&offset` | Liste / recherche |
| GET `/files/usage` | Quota et répartition |
| GET `/files/:id` | Détail + niveau d'accès |
| PATCH `/files/:id` `{name?,description?,tags?,folderId?}` | Renomme, déplace, décrit |
| DELETE `/files/:id` | Corbeille |
| GET `/files/:id/download[?inline=1]` | URL signée de téléchargement (droit vérifié avant) |
| GET `/files/:id/preview` | Aperçu : `geojson` (données), `image`/`pdf` (URL signée), `text` |

## Dossiers et corbeille

`POST /folders`, `GET /folders/:id|root/contents`, `PATCH /folders/:id` (nom, parent), `DELETE /folders/:id` (corbeille). Corbeille : `GET /trash`, `POST /trash/files|folders/:id/restore`, `DELETE /trash/files|folders/:id` (définitif), `POST /trash/empty {confirm:true}`.

## Partages

| Méthode et chemin | Rôle |
|---|---|
| POST `/shares/links` `{fileId\|folderId, canDownload, expiresInDays}` | Crée un lien ; **le jeton n'est renvoyé qu'une fois** (dans `url`, fragment `#`) |
| POST `/shares/grants` `{fileId\|folderId, email, canDownload}` | Partage avec une personne (réponse identique si l'adresse n'a pas de compte) |
| GET `/shares?fileId=…\|folderId=…` | Partages d'une ressource (propriétaire) |
| DELETE `/shares/links/:id`, `/shares/grants/:id` | Révoque (le destinataire peut quitter) |
| GET `/shares/with-me`, `/shares/by-me` | Vues d'ensemble |
| GET `/public/share`, `/public/share/folders/:id`, `/public/share/files/:id/preview`, `/public/share/files/:id/download` | Accès par lien (en-tête `X-Share-Token`) |

## Administration (rôle ADMIN)

`GET /admin/stats`, `GET /admin/users`, `PATCH /admin/users/:id {quotaBytes?,disabled?}`, `GET /admin/audit`.

## Système

`GET /health`, `GET /config` (limites et formats, publics), `GET /cron/cleanup` (en-tête `Authorization: Bearer <CRON_SECRET>`).
