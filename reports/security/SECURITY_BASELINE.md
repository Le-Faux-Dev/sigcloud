# Base de sécurité (version de lancement)

Ce document décrit ce qui est **implémenté et vérifié** et ce qui ne l'est pas. Il ne prétend pas que l'application est « 100 % sécurisée » : aucune ne l'est.

## Mesures en place (avec la preuve)

| Domaine | Mesure | Vérifié par |
|---|---|---|
| Mots de passe | Argon2id (19 Mio, 2 itérations), 10 caractères minimum, comparaison à un hash factice pour ne pas révéler si un compte existe | tests `auth.test.js` |
| Sessions | Jeton aléatoire 256 bits, **seul son hash SHA-256 est en base** ; cookie HttpOnly + SameSite=Lax (+ Secure et préfixe `__Host-` en production) ; révocation, expiration ; changement de mot de passe = autres sessions fermées | `auth.test.js`, E2E |
| CSRF | Jeton par session (en-tête `X-CSRF-Token`) + contrôle de l'en-tête `Origin` sur toute écriture | `security.test.js` |
| Autorisation | Module d'accès unique ; ressource d'autrui = **404** (pas 403) ; liens et partages vérifiés à chaque requête | `files/folders/sharing/security.test.js` (IDOR) |
| Partage | Jeton de lien 256 bits stocké **haché** ; jeton dans le fragment `#` (jamais envoyé dans l'URL au serveur), transmis en en-tête ; expiration, révocation, droit de téléchargement séparé | `sharing.test.js`, E2E (révocation) |
| Fichiers | Liste blanche d'extensions ; taille max 50 Mo ; vérification de la signature/du contenu **côté serveur** à la fin de l'envoi ; nom assaini (traversée de chemin, caractères de contrôle, bidi) ; **les ZIP ne sont jamais extraits** | `files.test.js`, `policy.test.js` |
| Stockage | Bucket privé ; octets directement navigateur ↔ stockage par URL signée courte ; l'API ne renvoie jamais la clé de stockage | `files.test.js`, `dto.js` |
| Aperçus | GeoJSON validé/assaini, KML analysé avec refus de DOCTYPE/ENTITY (XXE), attributs affichés en `textContent`, PDF/images servis depuis l'origine du stockage | `geo.test.js`, E2E (XSS) |
| En-têtes | CSP stricte (`script-src 'self'`, `style-src 'self'`, aucun inline), HSTS, `nosniff`, `frame-ancestors 'none'`, `no-referrer`, COOP, Permissions-Policy | `security.test.js`, E2E : 0 violation |
| Abus | Limitation de débit (inscription, connexion par IP et par compte, envois, téléchargements, export…), quotas avec verrou `FOR UPDATE` | `security.test.js`, `files.test.js` |
| Journal | Événements d'audit ; IP stockée sous forme de HMAC ; jamais de mot de passe, jeton ni clé | `audit.js` |
| Production | Refus de démarrer avec secrets faibles, stockage local ou mail de développement | `config.test.js` |
| Front | Aucun `innerHTML`, aucun script/style en ligne (ESLint + `check-html`), polices et Leaflet auto-hébergés | lint, E2E |

## Ce qui n'est PAS fait

- **Pas d'antivirus ni d'analyse de malware.** L'interface dit « Format vérifié » (le contenu correspond au format) ou « Non analysé en profondeur » ; jamais « sain ».
- Pas de détection des bombes de décompression (les archives ne sont pas ouvertes, donc non analysées).
- Pas de double authentification (2FA), pas de connexion via un fournisseur externe.
- Pas de journal de sécurité exporté vers un outil de surveillance ; pas d'alertes.
- Pas de chiffrement applicatif des fichiers au repos (le chiffrement au repos du fournisseur de stockage s'applique).

## Vérifications réalisées pour ce rapport

76 tests serveur sur un vrai PostgreSQL, 81 contrôles dans Chromium (dont axe-core et sondes XSS), `npm audit` (0), semgrep (voir SAST_REPORT.md), recherche de secrets (voir SECRETS_SCAN.md).

Voir `RESIDUAL_RISKS.md` pour les risques restants.
