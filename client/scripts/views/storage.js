import { h, icon } from '../dom.js';
import { api } from '../api.js';
import { formatBytes, formatPercent, CATEGORY_LABELS } from '../format.js';
import { errorState } from '../ui.js';
import { viewHead, loadingBlock } from './common.js';

export async function storageView() {
  const root = h('div', { class: 'view' }, loadingBlock());
  try {
    const u = await api.get('/files/usage');
    const pct = formatPercent(u.usedBytes, u.quotaBytes);
    const cats = Object.entries(u.byCategory).sort((a, b) => b[1].bytes - a[1].bytes);
    const meter = h('div', { class: 'meter', role: 'progressbar', 'aria-label': "Espace de stockage utilisé", 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, h('span', { class: pct > 95 ? 'crit' : pct > 80 ? 'warn' : '', data: { w: pct } }));
    root.replaceChildren(
      viewHead('Stockage', 'Ton espace et ce qui l\'occupe.'),
      h('div', { class: 'panel panel-pad grid gap-3' },
        h('p', { class: 'm-0' }, h('strong', { text: formatBytes(u.usedBytes) }), ` utilisés sur ${formatBytes(u.quotaBytes)} (${pct} %)`),
        meter,
        pct > 80 ? h('div', { class: 'notice notice-warn' }, icon('triangle-alert'), h('p', { text: pct > 95 ? 'Ton espace est presque plein. Supprime des fichiers ou vide la corbeille pour continuer à importer.' : 'Ton espace se remplit. Pense à faire du ménage.' })) : null,
        u.trashCount ? h('p', { class: 'm-0' }, `La corbeille contient ${u.trashCount} élément(s) (${formatBytes(u.trashBytes)}) qui comptent encore dans ton quota. `, h('a', { href: '#/trash', text: 'Ouvrir la corbeille' })) : null),
      h('section', { class: 'panel', 'aria-labelledby': 'bycat' }, h('div', { class: 'panel-head' }, h('h2', { id: 'bycat', text: 'Par type de fichier' })),
        cats.length
          ? h('div', { class: 'table-wrap' }, h('table', { class: 'ftable' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Type' }), h('th', { scope: 'col', class: 'col-num', text: 'Fichiers' }), h('th', { scope: 'col', class: 'col-num', text: 'Taille' }))), h('tbody', {}, cats.map(([c, v]) => h('tr', {}, h('td', { class: 'col-name', text: CATEGORY_LABELS[c] ?? c }), h('td', { class: 'col-num', text: String(v.count) }), h('td', { class: 'col-num', text: formatBytes(v.bytes) }))))))
          : h('div', { class: 'panel-pad' }, h('p', { class: 'sub m-0', text: 'Aucun fichier pour le moment.' }))),
    );
    root.querySelectorAll('.meter > span[data-w]').forEach((s) => { s.style.width = `${s.dataset.w}%`; });
  } catch (err) {
    root.replaceChildren(errorState(err));
  }
  return { el: root, title: 'Stockage' };
}
