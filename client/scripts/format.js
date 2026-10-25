// Mise en forme (français). Aucune donnée n'est jamais interprétée comme du HTML.

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '–';
  if (n < 1000) return `${nf0.format(n)} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let v = n;
  let i = -1;
  do {
    v /= 1000;
    i += 1;
  } while (v >= 1000 && i < units.length - 1);
  return `${nf.format(v)} ${units[i]}`;
}

export const formatCount = (n) => nf0.format(n);

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const formatDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '–');
export const formatDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : '–');

export function formatPercent(used, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((used / total) * 1000) / 10);
}

/** Chemin de hachage sûr : `#/files/<uuid>?q=…` → { path: ['files', '<uuid>'], query: URLSearchParams } */
export function parseHash(hash) {
  const raw = (hash || '').replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  return { path: pathPart.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(queryPart) };
}

export const CATEGORY_LABELS = {
  vector: 'Vecteur',
  raster: 'Raster',
  image: 'Image',
  document: 'Document',
  archive: 'Archive',
  project: 'Projet SIG',
};

export const CATEGORY_ICONS = {
  vector: 'map',
  raster: 'layers',
  image: 'file-image',
  document: 'file-text',
  archive: 'file-archive',
  project: 'package',
};
