# Risques résiduels et points non vérifiés

Classés par importance pour une mise en ligne. « À vérifier » = je n'ai pas pu le tester dans mon environnement.

## À vérifier avant la mise en production

| # | Point | Pourquoi | Comment |
|---|---|---|---|
| 1 | **Pilote Cloudflare R2 non testé contre un vrai bucket** (signatures, envoi en parties, `ListParts`, suppression) | Aucun identifiant R2 dans mon environnement ; seul le pilote local a été exécuté | Suivre `docs/DEPLOYMENT.md`, puis envoyer un fichier > 8 Mo et un petit, télécharger, supprimer |
| 2 | **CORS du bucket R2** (envoi par `PUT` depuis le navigateur) | Configuration côté Cloudflare, jamais testée | Exemple dans `docs/DEPLOYMENT.md` ; tester un envoi réel |
| 3 | **Migration Prisma jamais exécutée par `prisma migrate`** | Le SQL a été écrit à la main et appliqué avec `pg` sur PostgreSQL local ; le moteur de migration Prisma n'était pas téléchargeable | `npx prisma migrate deploy` sur une base Neon vide ; `prisma migrate diff` pour vérifier l'absence d'écart |
| 4 | **Réécriture `/api/*` → fonction Vercel** | `vercel.json` n'a pas été testé sur Vercel ; Express doit recevoir l'URL d'origine | Après déploiement : `GET /api/v1/health` doit répondre `{"ok":true}` |
| 5 | **Neon : URL poolée vs directe, démarrage à froid** | Non mesuré | `DATABASE_URL` poolée, `DIRECT_URL` directe ; première requête après veille plus lente |
| 6 | **Limites des offres gratuites** (Vercel, Neon, R2) | Elles changent ; non revérifiées en ligne | Relire les pages de tarification le jour du déploiement |
| 7 | **Limitation de débit en mémoire sur Vercel** | En serverless, chaque instance a sa mémoire : la limite est partielle | Mettre `RATE_LIMIT_STORE=postgres` ou `upstash` (Upstash non testé) |
| 8 | Tuiles OpenStreetMap | La politique d'usage d'OSM interdit un usage intensif | Prévoir un fournisseur de tuiles dédié si le trafic augmente |

## Risques de conception connus

| Risque | Gravité | Atténuation actuelle | Suite possible |
|---|---|---|---|
| Fichier malveillant stocké puis téléchargé par un tiers | Moyenne | Pas d'exécution côté serveur ; `Content-Disposition: attachment` ; étiquette « non analysé en profondeur » ; téléchargement désactivable par lien | Worker d'analyse (ClamAV) après le MVP |
| Compte compromis (pas de 2FA) | Moyenne | Argon2id, limitation de débit, sessions révocables | 2FA TOTP |
| Lien de partage transmis à un tiers non voulu | Moyenne | Expiration, révocation, consultation seule par défaut | Mot de passe de lien |
| Abus de stockage via comptes multiples | Basse à moyenne | Quota par compte, limite d'inscriptions par IP | Vérification de l'e-mail, CAPTCHA |
| Perte de données | Moyenne | Corbeille 30 jours | Sauvegardes Neon (restauration à un instant donné) ; versionnage du bucket |
| E-mail désactivé par défaut | Basse | Réinitialisation de mot de passe indisponible tant qu'aucun service d'envoi n'est configuré | Brancher un service d'e-mail transactionnel |
| Fuseaux horaires / dates | Basse | Dates stockées en UTC, affichées en locale du navigateur | — |

## Non couvert par les tests

Safari et Firefox, vrais mobiles, lecteurs d'écran, charge (aucun test de montée en charge), audit externe.
