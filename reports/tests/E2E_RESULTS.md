# Résultats des tests dans un vrai navigateur (Chromium headless)

Date : 2026-10-25. Commande : `npm run test:e2e`. Navigateur : Chromium headless (@sparticuz/chromium) piloté par puppeteer-core, contre l'application réelle (Express + PostgreSQL embarqué + stockage local). Accessibilité : axe-core (WCAG 2.0/2.1 A et AA + bonnes pratiques).

**81/81 contrôles réussis** (largeurs testées : 300, 320, 360, 390, 768, 1024, 1440 px).

| Contrôle | Résultat |
|---|---|
| accueil : tableau des formats chargé depuis l'API | OK |
| accueil : courbes de niveau insérées | OK |
| axe accueil | OK |
| axe inscription | OK |
| inscription : mot de passe trop court bloqué (reste sur la page) | OK |
| inscription : arrivée dans l'espace | OK |
| tableau de bord affiché | OK |
| focus placé sur le titre de la vue | OK |
| axe tableau de bord (vide) | OK |
| envois : 3 fichiers valides terminés | OK |
| envois : .exe refusé côté client avec message | OK |
| envois : faux GeoJSON refusé par le serveur | OK |
| axe explorateur + panneau d'envois | OK |
| explorateur : fichiers listés | OK |
| dossier créé | OK |
| carte : 3 entités dessinées (point, ligne, polygone) | OK |
| carte : attributs affichés en texte (XSS neutralisé) | OK |
| XSS : aucun script exécuté depuis les données | OK |
| XSS : aucune balise <img> injectée par les attributs | OK |
| axe visionneuse carte | OK |
| axe dialogue de partage | OK |
| lien : jeton dans le fragment (#) | OK |
| partage public : carte visible sans compte | OK |
| partage public : pas de bouton télécharger (consultation seule) | OK |
| partage public : jeton absent de l'historique serveur (envoyé en en-tête) | OK |
| axe page de partage public | OK |
| révocation : le lien ne fonctionne plus | OK |
| axe tableau de bord | OK |
| axe stockage | OK |
| axe partagés avec moi | OK |
| axe partagés par moi | OK |
| axe corbeille | OK |
| axe profil et sécurité | OK |
| corbeille : élément présent | OK |
| corbeille : restauration | OK |
| responsive 300px : pas de défilement horizontal de la page | OK |
| mobile 300px : menu ouvrable | OK |
| mobile 300px : Échap ferme le menu | OK |
| accueil 300px : menu hamburger présent et menu replié | OK |
| accueil 300px : le menu s'ouvre | OK |
| accueil 300px : Échap referme le menu | OK |
| accueil 300px : bandeaux de formats et 3 écrans animés présents | OK |
| responsive accueil 300px : pas de défilement horizontal | OK |
| responsive 320px : pas de défilement horizontal de la page | OK |
| mobile 320px : menu ouvrable | OK |
| mobile 320px : Échap ferme le menu | OK |
| accueil 320px : menu hamburger présent et menu replié | OK |
| accueil 320px : le menu s'ouvre | OK |
| accueil 320px : Échap referme le menu | OK |
| accueil 320px : bandeaux de formats et 3 écrans animés présents | OK |
| responsive accueil 320px : pas de défilement horizontal | OK |
| responsive 360px : pas de défilement horizontal de la page | OK |
| mobile 360px : menu ouvrable | OK |
| mobile 360px : Échap ferme le menu | OK |
| accueil 360px : menu hamburger présent et menu replié | OK |
| accueil 360px : le menu s'ouvre | OK |
| accueil 360px : Échap referme le menu | OK |
| accueil 360px : bandeaux de formats et 3 écrans animés présents | OK |
| responsive accueil 360px : pas de défilement horizontal | OK |
| responsive 390px : pas de défilement horizontal de la page | OK |
| mobile 390px : menu ouvrable | OK |
| mobile 390px : Échap ferme le menu | OK |
| accueil 390px : menu hamburger présent et menu replié | OK |
| accueil 390px : le menu s'ouvre | OK |
| accueil 390px : Échap referme le menu | OK |
| accueil 390px : bandeaux de formats et 3 écrans animés présents | OK |
| responsive accueil 390px : pas de défilement horizontal | OK |
| responsive 768px : pas de défilement horizontal de la page | OK |
| mobile 768px : menu ouvrable | OK |
| mobile 768px : Échap ferme le menu | OK |
| accueil 768px : bandeaux de formats et 3 écrans animés présents | OK |
| responsive accueil 768px : pas de défilement horizontal | OK |
| responsive 1024px : pas de défilement horizontal de la page | OK |
| accueil 1024px : bandeaux de formats et 3 écrans animés présents | OK |
| responsive accueil 1024px : pas de défilement horizontal | OK |
| responsive 1440px : pas de défilement horizontal de la page | OK |
| accueil 1440px : bandeaux de formats et 3 écrans animés présents | OK |
| responsive accueil 1440px : pas de défilement horizontal | OK |
| déconnexion → page de connexion | OK |
| axe connexion | OK |
| espace protégé sans session → connexion | OK |

- Violations de CSP observées : 0
- Erreurs de console : 0
- Exceptions de page : 0
- Réponses HTTP 5xx : 0

## Bugs trouvés par ces tests puis corrigés

- La CSP bloquait les tuiles OpenStreetMap (`*.tile.openstreetmap.org` ne couvre pas `tile.openstreetmap.org`).
- La sélection de fichiers était vidée avant lecture (liste du champ « vivante ») : aucun envoi ne démarrait.
- La page de partage ne gérait pas le code d'un lien révoqué.
- Accueil : étiquette ARIA invalide sur les pastilles de formats (axe).
- Texte « null » affiché dans l'explorateur ; ordre des titres ; deux repères « search » ; liens non soulignés dans le texte.

## Ce que ces tests ne couvrent pas

- Les tuiles OpenStreetMap n'ont pas été chargées (pas d'accès réseau) : seule l'autorisation CSP est vérifiée.
- Aucun test avec Cloudflare R2 réel (stockage local utilisé), ni sur Safari/Firefox, ni sur un vrai mobile.
- Le partage avec une personne (par e-mail) est couvert par les tests d'intégration serveur, pas par ce parcours navigateur.
- axe-core ne détecte qu'une partie des problèmes d'accessibilité : un test manuel au lecteur d'écran reste nécessaire.
