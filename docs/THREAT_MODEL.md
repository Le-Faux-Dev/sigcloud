# Modèle de menaces (version de lancement)

Méthode : STRIDE simplifiée, par actif. « Test » = test automatisé qui le vérifie.

## Actifs

Fichiers des utilisateurs (confidentialité), comptes et sessions, liens de partage, disponibilité du service, clés d'accès au stockage et à la base.

## Menaces principales

| Menace | Scénario | Mesure | Test |
|---|---|---|---|
| Lecture du fichier d'un autre (IDOR) | Deviner/énumérer des identifiants | UUID + contrôle d'accès central + 404 | `security.test.js`, `files.test.js` |
| Téléchargement sans droit | Lien « consultation seule » utilisé pour télécharger | Droit vérifié côté serveur avant l'URL signée ; aperçu et téléchargement séparés | `sharing.test.js` |
| Fuite d'un lien | Lien partagé trop largement | Expiration, révocation immédiate, jeton haché en base, fragment `#` hors journaux | `sharing.test.js`, E2E |
| XSS via données de fichier | Attribut GeoJSON/KML ou nom de fichier contenant du HTML | Rendu en `textContent`, CSP sans inline, Leaflet reçoit des nœuds DOM | E2E (sonde `<img onerror>`) |
| XXE / bombes d'entités | KML avec DTD | DOCTYPE/ENTITY refusés avant analyse | `geo.test.js` |
| Fichier déguisé | `.png` qui contient autre chose | Vérification de signature au `complete` | `files.test.js` |
| Traversée de chemin | Nom `../../x` | Nom assaini ; clé de stockage générée par le serveur | `policy.test.js` |
| CSRF | Site tiers déclenchant une écriture | Jeton CSRF + contrôle `Origin` + SameSite=Lax | `security.test.js` |
| Force brute / bourrage d'identifiants | Essais massifs de mots de passe | Argon2id, limites par IP et par compte, messages uniformes | `auth.test.js`, `security.test.js` |
| Énumération de comptes | Distinguer « compte inconnu » | Réponses et temps comparables, hash factice | `auth.test.js` |
| Épuisement du quota / course | Envois simultanés pour dépasser le quota | Réservation transactionnelle (`FOR UPDATE`) | `files.test.js` |
| Déni de service par envoi | Gros fichiers, envois abandonnés | 50 Mo max, quota, nettoyage planifié, limites de débit | `files.test.js` |
| Session volée | Cookie dérobé | HttpOnly, Secure, révocation, liste des appareils | `auth.test.js` |
| Compromission de la chaîne logicielle | Paquet npm piégé | `npm ci`, lockfile, `npm audit`, peu de dépendances | `DEPENDENCY_AUDIT.md` |
| Exécution d'un projet SIG malveillant | `.qgz` avec scripts | Jamais ouvert ni exécuté ; avertissement | n/a (stockage seul) |

## Hors périmètre / non couvert

Malware dans les fichiers (pas d'antivirus), attaques sur Vercel/Neon/Cloudflare eux-mêmes, hameçonnage des utilisateurs, accès physique, attaquant disposant déjà d'un compte administrateur.
