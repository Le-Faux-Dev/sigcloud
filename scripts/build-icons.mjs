// Génère client/assets/icons.svg (sprite) à partir de lucide-static. Une seule bibliothèque d'icônes, jamais d'emoji.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ICONS = [
  'folder', 'folder-plus', 'folder-open', 'folder-input', 'file', 'file-text', 'file-image', 'file-archive', 'file-spreadsheet', 'file-code', 'file-question',
  'map', 'map-pin', 'layers', 'upload', 'download', 'share-2', 'link', 'copy', 'check', 'x', 'trash-2', 'rotate-ccw', 'search', 'menu',
  'layout-dashboard', 'users', 'user', 'settings', 'log-out', 'hard-drive', 'shield-check', 'shield-alert', 'triangle-alert', 'info', 'eye',
  'ellipsis', 'chevron-right', 'chevron-down', 'arrow-left', 'list', 'layout-grid', 'plus', 'pencil', 'lock', 'globe', 'clock', 'circle-check',
  'circle-x', 'loader-circle', 'key-round', 'monitor', 'external-link', 'database', 'compass', 'mountain', 'inbox', 'send', 'refresh-cw',
  'sliders-horizontal', 'package', 'activity', 'crosshair',
  'arrow-up', 'arrow-down', 'arrow-right', 'cloud-upload', 'corner-left-up', 'ellipsis-vertical', 'gauge', 'link-2-off', 'map-pinned', 'search-x',
  'pause', 'play', 'undo-2', 'user-check', 'user-minus', 'user-plus', 'user-round', 'user-x',
];

const symbols = [];
for (const name of ICONS) {
  let svg;
  try {
    svg = await readFile(join(root, 'node_modules/lucide-static/icons', `${name}.svg`), 'utf8');
  } catch {
    throw new Error(`Icône Lucide introuvable : « ${name} »`);
  }
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  symbols.push(`<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`);
}

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join('\n')}\n</svg>\n`;
await mkdir(join(root, 'client/assets'), { recursive: true });
// Les symboles sont référencés avec <use href="/assets/icons.svg#i-nom"> ; le style (trait, épaisseur) vient du CSS.
await writeFile(join(root, 'client/assets/icons.svg'), sprite.replace(' style="display:none"', ''));
console.log(`Sprite d'icônes : ${ICONS.length} icônes.`);
