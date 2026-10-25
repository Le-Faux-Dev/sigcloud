import { h, icon } from './dom.js';
import { getConfig, loadSession } from './api.js';
import { CATEGORY_LABELS } from './format.js';
import { mountContours } from './contours.js';
import './site-header.js';

mountContours(document.getElementById('contours'));

// Si une session existe, le bouton principal mène à l'espace de travail.
loadSession().then((user) => {
  if (!user) return;
  for (const a of document.querySelectorAll('[data-auth-cta]')) {
    a.href = '/app.html';
    a.querySelector('span').textContent = 'Ouvrir mon espace';
  }
  document.querySelectorAll('[data-guest]').forEach((e) => e.remove());
}).catch(() => {});

// Formats : lus depuis la configuration réelle du serveur (jamais écrits en dur dans la page).
const host = document.getElementById('formats-body');
const rowsHost = document.getElementById('marquee-rows');
const toggleBtn = document.getElementById('marquee-toggle');

function chip(f) {
  return h('li', { class: `fchip fchip-${f.category}` }, h('strong', { text: `.${f.ext}` }), h('span', { text: f.label }), f.previewable ? h('span', { class: 'fchip-eye' }, icon('eye'), h('span', { class: 'sr-only', text: '(aperçu disponible)' })) : null);
}

getConfig().then((cfg) => {
  host.replaceChildren(...cfg.formats.map((f) => h('tr', {},
    h('td', {}, h('strong', { text: `.${f.ext}` })),
    h('td', { text: f.label }),
    h('td', { text: CATEGORY_LABELS[f.category] ?? f.category }),
    h('td', {}, f.previewable ? h('span', { class: 'badge badge-info' }, icon('eye'), 'Aperçu dans le navigateur') : h('span', { class: 'badge badge-neutral' }, icon('database'), 'Stocké et téléchargeable')))));
  // Deux bandeaux défilant en sens inverse : vecteur / raster et images / documents et projets.
  const groups = [cfg.formats.filter((f) => f.category === 'vector'), cfg.formats.filter((f) => f.category !== 'vector')];
  rowsHost.replaceChildren(...groups.map((list, i) => {
    const set = () => h('ul', { class: 'marquee-set' }, list.map(chip));
    const dup = set();
    dup.setAttribute('aria-hidden', 'true'); // copie visuelle pour la boucle : ignorée par les lecteurs d'écran
    return h('div', { class: `marquee-row${i ? ' rev' : ''}` }, set(), dup);
  }));
}).catch(() => {
  host.replaceChildren(h('tr', {}, h('td', { colspan: '4', text: 'La liste des formats n\'a pas pu être chargée pour le moment.' })));
  rowsHost.replaceChildren(h('p', { class: 'wrap', text: 'La liste des formats n\'a pas pu être chargée pour le moment.' }));
});

// WCAG 2.2.2 : un contenu qui bouge plus de 5 s doit pouvoir être mis en pause.
toggleBtn.addEventListener('click', () => {
  const paused = rowsHost.toggleAttribute('data-paused');
  toggleBtn.setAttribute('aria-pressed', String(paused));
  toggleBtn.querySelector('span').textContent = paused ? 'Reprendre le défilement' : 'Mettre en pause le défilement';
  toggleBtn.replaceChild(icon(paused ? 'play' : 'pause'), toggleBtn.querySelector('svg'));
});
