import { h, icon, badge } from './dom.js';
import { CATEGORY_ICONS } from './format.js';
import { formatBytes } from './format.js';

/** Icône de fichier d'après sa catégorie. */
export const fileIconName = (file) => CATEGORY_ICONS[file.category] ?? 'file';

export function fileIconBox(file) {
  return h('span', { class: 'ficon', 'aria-hidden': 'true' }, icon(fileIconName(file)));
}

export function folderIconBox() {
  return h('span', { class: 'ficon folder', 'aria-hidden': 'true' }, icon('folder'));
}

/** État de sécurité : on ne dit JAMAIS « sain » — il n'y a pas d'antivirus dans cette version. */
export function securityBadge(file) {
  switch (file.securityStatus) {
    case 'FORMAT_VERIFIED':
      return badge('ok', 'shield-check', 'Format vérifié');
    case 'NOT_DEEP_SCANNED':
      return badge('warn', 'triangle-alert', 'Non analysé en profondeur');
    default:
      return badge('neutral', 'clock', 'En attente');
  }
}

export function previewBadge(file) {
  return file.previewStatus === 'PREVIEWABLE' ? badge('info', 'eye', 'Aperçu disponible') : badge('neutral', 'database', 'Stocké seulement');
}

export const SECURITY_EXPLANATION =
  "« Format vérifié » signifie que le contenu correspond au format annoncé. Ce n'est pas une analyse antivirus : « non analysé en profondeur » indique que le contenu d'une archive ou d'un format complexe n'a pas été ouvert.";

/** Explication d'un aperçu impossible, sans jamais inventer de capacité. */
export function previewReasonText(file, config) {
  const mb = Math.floor((config?.limits?.previewMaxBytes ?? 10485760) / 1024 / 1024);
  switch (file.previewReason) {
    case 'TOO_LARGE':
      return `Ce fichier dépasse la limite d'aperçu (${mb} Mo). Il reste stocké : télécharge-le pour l'ouvrir dans QGIS, ArcGIS ou un autre outil.`;
    case 'COORDINATES_NOT_WGS84':
    case 'CRS_NOT_WGS84':
      return "Les coordonnées ne sont pas en WGS84 (EPSG:4326), le seul système géré par l'aperçu. Le fichier reste stocké et téléchargeable.";
    case 'TOO_MANY_FEATURES':
      return "Ce fichier contient trop d'éléments pour un aperçu fluide dans le navigateur. Télécharge-le pour l'ouvrir dans un logiciel SIG.";
    case 'NOT_GEOJSON':
      return "Ce fichier JSON n'est pas du GeoJSON : il est stocké comme un fichier ordinaire.";
    default:
      return "Ce format est stocké et téléchargeable, mais le navigateur ne sait pas encore l'afficher. Seuls les GeoJSON, KML, images, PDF et fichiers texte ont un aperçu.";
  }
}

/** Avertissement propre aux projets SIG (QGIS/ArcGIS) : ils référencent souvent des couches externes. */
export function projectWarning() {
  return h(
    'div',
    { class: 'notice notice-warn' },
    icon('triangle-alert'),
    h('p', { text: "Un projet QGIS ou ArcGIS pointe souvent vers des couches stockées ailleurs. Importe aussi les fichiers de données qu'il utilise (de préférence dans le même dossier ou dans un ZIP), sinon il s'ouvrira avec des couches manquantes. SIG-Cloud ne peut pas détecter les couches absentes." }),
  );
}

export const sizeLabel = (file) => formatBytes(file.sizeBytes);

export function emptyState({ iconName = 'inbox', title, text, action }) {
  return h('div', { class: 'empty' }, icon(iconName, 'icon-xl'), h('h2', { text: title }), text ? h('p', { text }) : null, action ?? null);
}

export function errorState(err, { retry } = {}) {
  const forbidden = err.status === 404 || err.status === 403;
  return h(
    'div',
    { class: 'empty', role: 'alert' },
    icon(forbidden ? 'lock' : 'triangle-alert', 'icon-xl'),
    h('h2', { text: forbidden ? 'Élément introuvable ou accès refusé' : 'Chargement impossible' }),
    h('p', { text: forbidden ? "Cet élément n'existe pas, a été supprimé, ou son propriétaire ne te l'a pas partagé." : err.message }),
    retry ? h('button', { type: 'button', class: 'btn btn-secondary', text: 'Réessayer', on: { click: retry } }) : null,
  );
}
