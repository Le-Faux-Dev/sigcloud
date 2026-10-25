// Visualiseur cartographique (Leaflet). Les données du fichier sont NON FIABLES : valeurs affichées avec textContent
// uniquement, jamais de HTML. Leaflet est chargé à la demande depuis /assets/vendor (auto-hébergé, CSP « self »).
import { h, icon } from './dom.js';

let leafletPromise;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  leafletPromise ??= new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = h('link', { rel: 'stylesheet', href: '/assets/vendor/leaflet/leaflet.css', 'data-leaflet': '1' });
      document.head.append(css);
    }
    const s = h('script', { src: '/assets/vendor/leaflet/leaflet.js' });
    s.addEventListener('load', () => resolve(window.L));
    s.addEventListener('error', () => reject(new Error('Impossible de charger la bibliothèque cartographique.')));
    document.head.append(s);
  });
  return leafletPromise;
}

const STYLE = {
  point: { radius: 7, color: '#0f6b49', weight: 2, fillColor: '#38c68e', fillOpacity: 0.9 },
  line: { color: '#1a5690', weight: 3, opacity: 0.95 },
  poly: { color: '#0f6b49', weight: 2, fillColor: '#137a55', fillOpacity: 0.25 },
};

const kindOf = (geometry) => {
  const t = geometry?.type ?? '';
  if (t.includes('Point')) return 'point';
  if (t.includes('Line')) return 'line';
  return 'poly';
};

function attributeTable(props) {
  const rows = Object.entries(props ?? {});
  if (!rows.length) return h('p', { class: 'sub', text: 'Aucun attribut pour cet élément.' });
  const table = h('table', { class: 'attr-table' });
  for (const [k, v] of rows) table.append(h('tr', {}, h('th', { scope: 'row', text: k }), h('td', { text: v === null ? '(vide)' : String(v) })));
  return table;
}

/**
 * Monte la carte dans `container`. Retourne { destroy }.
 * `data` : FeatureCollection déjà assainie par le serveur (et re-validée à chaque aperçu).
 */
export async function mountMap(container, data, meta) {
  const L = await loadLeaflet();
  const mapEl = h('div', { class: 'map', role: 'application', 'aria-label': 'Carte interactive. Utilise les flèches pour déplacer la carte et + ou - pour zoomer.', tabindex: '0' });
  const mapWrap = h('div', { class: 'map-wrap' }, mapEl);

  const kinds = new Set();
  const layers = new Map();
  const attrBox = h('div', { class: 'panel-pad', 'aria-live': 'polite' }, h('p', { class: 'sub', text: 'Clique sur un élément de la carte pour voir ses attributs.' }));

  const map = L.map(mapEl, { zoomControl: true, attributionControl: true, worldCopyJump: true });
  L.control.scale({ imperial: false }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">les contributeurs d’OpenStreetMap</a>',
  }).addTo(map);

  const groups = { point: [], line: [], poly: [] };
  for (const f of data.features) {
    if (!f.geometry) continue;
    const kind = kindOf(f.geometry);
    kinds.add(kind);
    groups[kind].push(f);
  }
  const labels = { point: 'Points', line: 'Lignes', poly: 'Polygones' };
  for (const kind of Object.keys(groups)) {
    if (!groups[kind].length) continue;
    const layer = L.geoJSON({ type: 'FeatureCollection', features: groups[kind] }, {
      pointToLayer: (_f, latlng) => L.circleMarker(latlng, STYLE.point),
      style: () => STYLE[kind],
      onEachFeature: (feature, lyr) => {
        const props = feature.properties ?? {};
        const title = props.name ?? props.nom ?? props.Name ?? props.NAME;
        lyr.on('click', () => {
          attrBox.replaceChildren(h('h3', { class: 'text-base', text: title ? String(title) : 'Élément sélectionné' }), attributeTable(props));
        });
        // Leaflet interprète une CHAÎNE comme du HTML : on lui passe un nœud DOM dont le contenu est du texte brut.
        if (title) lyr.bindTooltip(h('span', { text: String(title) }));
      },
    }).addTo(map);
    layers.set(kind, layer);
  }

  const bbox = meta?.bbox;
  if (bbox) {
    map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [30, 30], maxZoom: 16 });
  } else {
    map.setView([5.35, -4.0], 3);
  }

  // Légende et activation des couches (cases à cocher : accessibles au clavier)
  const legend = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Couches' }), icon('layers')));
  const legendBody = h('div', { class: 'panel-pad' });
  const list = h('div', { class: 'grid gap-3' });
  for (const kind of ['point', 'line', 'poly']) {
    if (!layers.has(kind)) continue;
    const cb = h('input', { type: 'checkbox', checked: true, id: `layer-${kind}` });
    cb.addEventListener('change', () => (cb.checked ? layers.get(kind).addTo(map) : map.removeLayer(layers.get(kind))));
    list.append(h('label', { class: 'check', for: `layer-${kind}` }, cb, h('span', { class: 'legend-row' }, h('span', { class: `swatch ${kind}`, 'aria-hidden': 'true' }), `${labels[kind]} (${groups[kind].length})`)));
  }
  legendBody.append(list);
  legend.append(legendBody);

  const info = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Attributs' })), attrBox);
  const side = h('div', { class: 'map-panel' }, legend, info);
  const zoomBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', on: { click: () => bbox && map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [30, 30], maxZoom: 16 }) } }, icon('crosshair'), h('span', { text: 'Zoom sur les données' }));
  side.prepend(zoomBtn);

  container.append(h('div', { class: 'viewer-grid' }, mapWrap, side));
  // La carte doit recalculer sa taille une fois insérée dans le DOM
  setTimeout(() => map.invalidateSize(), 0);

  return { destroy: () => map.remove(), map };
}
