# SIG-Cloud

Un « Drive » pour les données géospatiales : **stocker**, **prévisualiser** (carte, image, PDF, texte) et **partager** (lien ou personnes précises) des fichiers SIG. Version de lancement (MVP).

- Application : Node 22 + Express 5, PostgreSQL (Neon) via Prisma, stockage objet Cloudflare R2 (privé), front en JavaScript natif + Tailwind + Leaflet + icônes Lucide.
- Hébergement visé : Vercel (front statique + fonction serverless) + Neon + R2. Tout reste en gratuit au démarrage, sous réserve des limites des offres (à revérifier : voir `docs/DEPLOYMENT.md`).

## Démarrage local (sans compte externe)

Prérequis : Node 22 et un PostgreSQL local (ou un projet Neon de test).

```bash
npm ci
cp .env.example .env            # Windows PowerShell : Copy-Item .env.example .env
# édite .env : APP_SECRET, CRON_SECRET (générés avec la commande indiquée dans le fichier) et DATABASE_URL
npx prisma migrate deploy       # applique prisma/migrations
npm run build                   # client Prisma, icônes, Leaflet, courbes de niveau, CSS
npm run dev   
                  # http://localhost:3000
```

En développement, le stockage est un dossier local (`.data/storage`) et les e-mails ne sont pas envoyés. Pour avoir un administrateur : crée un compte via l'inscription, puis `npm run create-admin -- ton@email.com`.

> Les migrations ont été écrites à la main et appliquées avec succès sur un vrai PostgreSQL, mais **pas** avec `prisma migrate` (moteur indisponible dans mon environnement). Lance `npx prisma migrate deploy` sur une base vide et signale tout écart.

## Commandes

| Commande | Rôle |
|---|---|
| `npm test` | 76 tests serveur sur un vrai PostgreSQL embarqué (aucune base à installer) |
| `npm run test:e2e` | Parcours complet dans Chromium headless + accessibilité (axe-core) ; écrit des captures dans `reports/screenshots` |
| `npm run lint` | ESLint (interdit `innerHTML`, `eval`…) |
| `npm run check:html` | Contrôle des pages : pas de script/style inline, `lang`, libellés, `id` uniques |
| `npm run audit:deps` | `npm audit` (production) |
| `npm run scan:secrets` | Recherche de secrets dans le dépôt |
| `npm run build` | Génère les ressources du front |

## Contenu du projet

```
api/            point d'entrée Vercel (fonction serverless)
client/         pages HTML, scripts ES modules, styles Tailwind, ressources
server/src/     config, middleware, routes, services (accès, fichiers, partages…), stockage
server/tests/   tests unitaires et d'intégration
prisma/         schéma et migrations SQL
scripts/        build, tests, création d'admin, contrôles
e2e/            test navigateur
docs/           architecture, API, sécurité, déploiement…
reports/        rapports de sécurité et de tests (sorties réelles d'outils)
```

## Ce qu'il faut savoir avant de publier

1. **Pas d'antivirus.** L'interface indique « Format vérifié » ou « Non analysé en profondeur », jamais « sain ». Les ZIP ne sont pas ouverts.
2. **Le stockage R2 réel n'a pas été testé** (aucun identifiant ici) : seul le stockage local l'a été. Suis `docs/DEPLOYMENT.md` pas à pas, y compris la configuration CORS du bucket.
3. L'aperçu carte (GeoJSON, KML, GPX) gère le **WGS84 (EPSG:4326)** uniquement, jusqu'à 10 Mo ; les autres formats SIG (Shapefile, GeoTIFF, GeoPackage, DXF…) sont stockés et téléchargeables, sans aperçu. Voir `docs/FILE_FORMATS.md`.
4. Le fonctionnement sur Vercel (réécriture `/api`, cron) doit être vérifié après le premier déploiement.

La liste complète des risques restants : `reports/security/RESIDUAL_RISKS.md`.

## Prochaines étapes (hors MVP)

Worker d'analyse (ClamAV) et de conversion (Shapefile/GeoTIFF → aperçu), 2FA, vérification d'e-mail, versionnage de fichiers. Voir `docs/ARCHITECTURE.md`.
