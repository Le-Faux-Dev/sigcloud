// Politique de formats SIG-Cloud (MVP). Source de vérité unique, documentée dans docs/FILE_FORMATS.md.
//
// - `signature` : contrôle du contenu réel (jamais l'extension seule). `none` = aucun contrôle fiable
//   implémenté : le fichier est alors marqué « non analysé en profondeur » et on le dit à l'utilisateur.
// - `preview`   : ce que le navigateur sait afficher au MVP.

/** @typedef {'vector'|'raster'|'image'|'document'|'archive'|'project'} Category */

/** @type {Record<string, {label: string, category: Category, signature: string, preview: 'geojson'|'kml'|'gpx'|'image'|'text'|'pdf'|null}>} */
export const FORMATS = {
  // Vecteur
  geojson: { label: 'GeoJSON', category: 'vector', signature: 'json', preview: 'geojson' },
  json: { label: 'JSON / GeoJSON', category: 'vector', signature: 'json', preview: 'geojson' },
  kml: { label: 'KML', category: 'vector', signature: 'xml', preview: 'kml' },
  kmz: { label: 'KMZ', category: 'vector', signature: 'zip', preview: null },
  gml: { label: 'GML', category: 'vector', signature: 'xml', preview: null },
  gpkg: { label: 'GeoPackage', category: 'vector', signature: 'sqlite', preview: null },
  gpx: { label: 'GPX (traces GPS)', category: 'vector', signature: 'xml', preview: 'gpx' },
  dxf: { label: 'DXF (dessin CAO, version texte)', category: 'vector', signature: 'text', preview: null },
  // Shapefile : l'ensemble .shp + .shx + .dbf + .prj (+ .cpg, .sbn, .sbx, .qmd, .lock) peut être envoyé fichier par fichier ou dans un ZIP.
  shp: { label: 'Shapefile (géométries)', category: 'vector', signature: 'shp', preview: null },
  shx: { label: 'Shapefile (index .shx)', category: 'vector', signature: 'shp', preview: null },
  dbf: { label: 'Shapefile (attributs .dbf)', category: 'vector', signature: 'dbf', preview: null },
  prj: { label: 'Système de coordonnées (.prj)', category: 'vector', signature: 'text', preview: null },
  cpg: { label: 'Encodage (.cpg)', category: 'vector', signature: 'text', preview: null },
  qmd: { label: 'Métadonnées QGIS (.qmd)', category: 'vector', signature: 'xml', preview: null },
  sbn: { label: 'Index spatial (.sbn)', category: 'vector', signature: 'shp', preview: null },
  sbx: { label: 'Index spatial (.sbx)', category: 'vector', signature: 'shp', preview: null },
  lock: { label: 'Fichier de verrou (.lock)', category: 'vector', signature: 'none', preview: null },
  // File Geodatabase : c'est un DOSSIER ; il doit être compressé en ZIP (le ZIP peut s'appeler « donnees.gdb »).
  gdb: { label: 'File Geodatabase (dossier .gdb compressé en ZIP)', category: 'vector', signature: 'zip', preview: null },
  // Rasters et images
  tif: { label: 'GeoTIFF / TIFF', category: 'raster', signature: 'tiff', preview: null },
  tiff: { label: 'GeoTIFF / TIFF', category: 'raster', signature: 'tiff', preview: null },
  jp2: { label: 'JPEG 2000', category: 'raster', signature: 'jp2', preview: null },
  ecw: { label: 'ECW', category: 'raster', signature: 'none', preview: null },
  img: { label: 'ERDAS IMAGINE (.img)', category: 'raster', signature: 'hfa', preview: null },
  vrt: { label: 'Raster virtuel (VRT)', category: 'raster', signature: 'xml', preview: null },
  asc: { label: 'ASCII Grid (.asc)', category: 'raster', signature: 'text', preview: null },
  sid: { label: 'MrSID (.sid)', category: 'raster', signature: 'sid', preview: null },
  bil: { label: 'BIL (raster par lignes)', category: 'raster', signature: 'none', preview: null },
  jpg: { label: 'JPEG', category: 'image', signature: 'jpeg', preview: 'image' },
  jpeg: { label: 'JPEG', category: 'image', signature: 'jpeg', preview: 'image' },
  png: { label: 'PNG', category: 'image', signature: 'png', preview: 'image' },
  webp: { label: 'WebP', category: 'image', signature: 'webp', preview: 'image' },
  // Documents
  csv: { label: 'CSV', category: 'document', signature: 'text', preview: 'text' },
  txt: { label: 'Texte', category: 'document', signature: 'text', preview: 'text' },
  xml: { label: 'XML', category: 'document', signature: 'xml', preview: null },
  xlsx: { label: 'Excel (XLSX)', category: 'document', signature: 'zip', preview: null },
  pdf: { label: 'PDF', category: 'document', signature: 'pdf', preview: 'pdf' },
  // Archives
  zip: { label: 'ZIP', category: 'archive', signature: 'zip', preview: null },
  // Projets SIG (stockage seul, jamais interprétés ni exécutés)
  qgz: { label: 'Projet QGIS (QGZ)', category: 'project', signature: 'zip', preview: null },
  qgs: { label: 'Projet QGIS (QGS)', category: 'project', signature: 'xml', preview: null },
  aprx: { label: 'Projet ArcGIS Pro (APRX)', category: 'project', signature: 'none', preview: null },
  ppkx: { label: 'Paquet de projet ArcGIS Pro (PPKX)', category: 'project', signature: 'zip', preview: null },
};

export const CATEGORIES = ['vector', 'raster', 'image', 'document', 'archive', 'project'];

/** Formats dont l'extension est connue mais volontairement refusée au MVP (message dédié). */
export const DEFERRED_FORMATS = new Set(['7z']);

/** Signatures binaires fiables. Chaque entrée : [offset, octets]. */
const SIGS = {
  jpeg: [[0, [0xff, 0xd8, 0xff]]],
  png: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  pdf: [[0, [0x25, 0x50, 0x44, 0x46, 0x2d]]],
  zip: [[0, [0x50, 0x4b, 0x03, 0x04]]], // archive non vide (une archive vide commence par PK\x05\x06 : refusée)
  sqlite: [[0, [...Buffer.from('SQLite format 3\0', 'latin1')]]],
  tiff: [
    [0, [0x49, 0x49, 0x2a, 0x00]],
    [0, [0x4d, 0x4d, 0x00, 0x2a]],
    [0, [0x49, 0x49, 0x2b, 0x00]],
    [0, [0x4d, 0x4d, 0x00, 0x2b]],
  ],
  shp: [[0, [0x00, 0x00, 0x27, 0x0a]]], // « file code » 9994 : Shapefile, .shx, .sbn, .sbx
  hfa: [[0, [...Buffer.from('EHFA_HEADER_TAG', 'latin1')]]],
  sid: [[0, [...Buffer.from('msid', 'latin1')]]],
  jp2: [[0, [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a]]],
};

function matches(buf, [offset, bytes]) {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buf[offset + i] !== bytes[i]) return false;
  return true;
}

/**
 * Vérifie le type réel d'après les premiers octets.
 * @param {string} kind clé de signature du format
 * @param {Buffer} head premiers octets du fichier (au moins 8 Ko si possible)
 * @returns {{ok: boolean, deep: boolean, detected: string}}
 *   deep = true quand le contrôle est assez fort pour dire « format vérifié ».
 */
export function checkSignature(kind, head) {
  switch (kind) {
    case 'webp':
      return { ok: head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP', deep: true, detected: 'webp' };
    case 'xml': {
      let s = head.toString('utf8');
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      const ok = s.trimStart().startsWith('<') && !head.includes(0);
      return { ok, deep: true, detected: 'xml' };
    }
    case 'text':
      return { ok: !head.subarray(0, 8192).includes(0), deep: true, detected: 'text' };
    case 'json': {
      let s = head.toString('utf8');
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
      const first = s.trimStart()[0];
      return { ok: first === '{' || first === '[', deep: true, detected: 'json' };
    }
    case 'dbf': // octet de version dBase/Visual FoxPro
      return { ok: head.length >= 32 && [0x02, 0x03, 0x04, 0x05, 0x30, 0x31, 0x32, 0x83, 0x8b, 0x8e, 0xf5, 0xfb].includes(head[0]), deep: true, detected: 'dbf' };
    case 'none':
      return { ok: true, deep: false, detected: 'unknown' };
    default: {
      const sigs = SIGS[kind];
      if (!sigs) return { ok: false, deep: false, detected: kind };
      return { ok: sigs.some((s) => matches(head, s)), deep: true, detected: kind };
    }
  }
}

/**
 * Analyse un nom de fichier. Retourne l'extension (minuscule) ou une erreur.
 * @param {string} name
 */
export function inspectName(name) {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
  if (!ext) return { ok: false, code: 'NO_EXTENSION' };
  if (DEFERRED_FORMATS.has(ext)) return { ok: false, code: 'FORMAT_DEFERRED', ext };
  if (!FORMATS[ext]) return { ok: false, code: 'FORMAT_NOT_ALLOWED', ext };
  return { ok: true, ext, format: FORMATS[ext] };
}

/**
 * Nettoie un nom d'élément (fichier ou dossier) fourni par l'utilisateur.
 * Aucun chemin n'est jamais utilisé tel quel : les clés de stockage sont aléatoires.
 */
export function sanitizeName(raw) {
  let n = String(raw ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, '') // contrôle + marques bidi (usurpation d'extension)
    .replace(/[\\/]+/g, '_')
    .trim();
  if (n === '.' || n === '..') n = '';
  return n.slice(0, 255);
}
