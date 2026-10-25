// Copie les ressources tierces dans client/assets/ (auto-hébergement : la CSP interdit les CDN et polices externes).
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'client/assets');
await mkdir(join(out, 'vendor/leaflet'), { recursive: true });
await mkdir(join(out, 'fonts'), { recursive: true });

const leaflet = join(root, 'node_modules/leaflet/dist');
await cp(join(leaflet, 'leaflet.js'), join(out, 'vendor/leaflet/leaflet.js'));
await cp(join(leaflet, 'leaflet.css'), join(out, 'vendor/leaflet/leaflet.css'));
await cp(join(leaflet, 'images'), join(out, 'vendor/leaflet/images'), { recursive: true });

const fonts = [
  ['@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2', 'bricolage-grotesque-latin.woff2'],
  ['@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2', 'instrument-sans-latin.woff2'],
];
for (const [src, dst] of fonts) await cp(join(root, 'node_modules', src), join(out, 'fonts', dst));

await writeFile(
  join(out, 'vendor/README.txt'),
  'Leaflet 1.9 (BSD-2-Clause), Bricolage Grotesque et Instrument Sans (SIL OFL 1.1) : copiés depuis node_modules par scripts/copy-vendor.mjs.\nNe pas modifier à la main.\n',
);
console.log('Ressources tierces copiées (Leaflet, polices).');
