# Design

**Principes** : outil de travail sobre, lisible sur le terrain (écran de téléphone en plein soleil), vocabulaire cartographique. Mise en page structurée, pas de décor gratuit.

- **Typographie** : Bricolage Grotesque (titres) et Instrument Sans (texte), auto-hébergées (`client/assets/fonts`), aucune requête vers un service de polices.
- **Couleurs** (jetons dans `client/styles/input.css`, bloc `@theme`) : bleu marine profond (navigation, actions principales), vert « végétation » (accent, état positif), ambre pour les avertissements, rouge pour le danger. Contrastes AA vérifiés par axe-core.
- **Motif** : courbes de niveau générées par calcul (marching squares sur un relief synthétique), `scripts/build-contours.mjs`.
- **Icônes** : Lucide (sprite SVG généré, 79 icônes). **Aucun emoji comme icône.** Le sens ne repose jamais sur la couleur seule (icône + texte dans les pastilles d'état).
- **Composants** : boutons, champs, pastilles, panneaux, tableaux qui deviennent des cartes sur mobile, menu contextuel au clavier, boîtes de dialogue `<dialog>` natives (piège à focus et Échap fournis par le navigateur), notifications `aria-live`.
- **Responsive** : testé à 360, 390, 768, 1024 et 1440 px (aucun défilement horizontal de la page). Menu latéral en tiroir sous 62 rem.
- **Accessibilité** : lien d'évitement, un seul `h1` par vue (reçoit le focus à chaque navigation), libellés explicites, état de tri (`aria-sort`), barres de progression avec `role="progressbar"`, `prefers-reduced-motion` respecté.
- **Vocabulaire de sécurité** : « Format vérifié » / « Non analysé en profondeur » / « En attente », avec une explication toujours accessible. Jamais « sain » ni « sécurisé ».

Captures : `reports/screenshots/`.

## Page d'accueil

- **Trois écrans animés** (ajouter, supprimer, partager) : maquettes en HTML/CSS pur (aucun script, aucune vidéo), mises à l'échelle avec des unités de conteneur (`cqw`) ; elles se lisent donc de 300 px à 1440 px. Le texte des étapes est réel (liste ordonnée sous chaque écran) ; les maquettes sont masquées aux lecteurs d'écran. Avec « réduire les animations » activé, chaque écran affiche son image finale.
- **Formats en bandeaux horizontaux** qui défilent (deux rangées en sens inverse), pause au survol, au focus clavier et par un bouton (WCAG 2.2.2). Le détail complet reste disponible dans un tableau repliable.
- **En-tête** : menu « hamburger » sous 48 rem (fermeture par Échap, clic extérieur ou lien) ; sans JavaScript le menu reste affiché.
