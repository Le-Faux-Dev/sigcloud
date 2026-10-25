# Plan de test

## Automatisés (exécutables par toi)

| Niveau | Commande | Contenu |
|---|---|---|
| Unitaires | `npm run test:unit` | formats et signatures, noms, GeoJSON/KML, configuration de production |
| Intégration | `npm test` | API complète sur un vrai PostgreSQL embarqué : authentification, fichiers (envoi simple et en parties, quotas, reprise), dossiers (cycles, profondeur, corbeille), partages (liens, personnes, révocation), sécurité (IDOR, CSRF, CORS, limites de débit, en-têtes) |
| Navigateur | `npm run test:e2e` | inscription, envois, refus de formats, carte et attributs, sonde XSS, partage public et révocation, corbeille, 5 largeurs, menu mobile, axe-core sur 14 écrans, 7 largeurs (300 à 1440 px) avec menu hamburger de l'accueil, 0 violation CSP |
| Statique | `npm run lint`, `npm run check:html` | interdits côté client, structure HTML |
| Sécurité | `npm run audit:deps`, `npm run scan:secrets` | dépendances, secrets |

État au 2026-10-25 : 76/76 tests serveur, 81/81 contrôles navigateur, lint propre. Voir `reports/tests/E2E_RESULTS.md`.

## Manuels recommandés avant la mise en ligne

1. **R2 réel** : fichier de 1 Mo, de 30 Mo (envoi en parties), coupure réseau en cours d'envoi puis « Reprendre », téléchargement, suppression.
2. **Partage** : lien « consultation seule » ouvert en navigation privée ; partage à une seconde adresse ; révocation ; expiration (modifier la date en base de test).
3. **Mobile réel** (Android bas de gamme, Safari iOS) : envoi, carte, menu.
4. **Lecteur d'écran** (NVDA ou VoiceOver) : parcours connexion → envoi → ouverture d'un fichier.
5. **Fichiers réels** : GeoJSON volumineux (limite d'aperçu), KML de Google Earth, GeoPackage, GeoTIFF de 40 Mo, Shapefile en ZIP.
6. **Sauvegarde/restauration** Neon sur une branche de test.
7. **Charge légère** (k6 ou autocannon) sur `/api/v1/health` et la liste des fichiers.
