import { h, icon, button } from './dom.js';
import { formatBytes, formatPercent } from './format.js';

/** Panneau flottant de suivi des envois (région « live » : les lecteurs d'écran annoncent la fin ou l'échec). */
export function mountUploadPanel(manager) {
  const live = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const list = h('ul', { class: 'upload-list' });
  const title = h('h2', { class: 'text-base' });
  const toggle = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Réduire le panneau des envois', 'aria-expanded': 'true' }, icon('chevron-down'));
  const clearBtn = button({ label: 'Effacer la liste', cls: 'btn btn-ghost btn-sm', onClick: () => manager.clearFinished() });
  const body = h('div', {}, list, h('div', { class: 'panel-pad' }, clearBtn));
  const root = h('section', { class: 'upload-panel', 'aria-label': 'Envois de fichiers', hidden: true }, h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, title, toggle), body));
  let collapsed = false;
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    body.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Afficher le panneau des envois' : 'Réduire le panneau des envois');
  });

  const rows = new Map();
  const statusText = (i) => {
    switch (i.status) {
      case 'queued': return 'En attente…';
      case 'uploading': return `Envoi ${formatPercent(i.loaded, i.size)} % · ${formatBytes(i.loaded)} sur ${formatBytes(i.size)}`;
      case 'verifying': return 'Vérification du contenu sur le serveur…';
      case 'done': return 'Terminé';
      case 'canceled': return 'Annulé';
      default: return i.error ?? 'Échec';
    }
  };

  function renderItem(i) {
    let row = rows.get(i.id);
    if (!row) {
      const nm = h('span', { class: 'nm' });
      const st = h('span', { class: 'st' });
      const bar = h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span'));
      const actions = h('span', { class: 'flex gap-1' });
      row = { el: h('li', { class: 'upload-item' }, h('div', { class: 'row' }, nm, actions), bar, st), nm, st, bar, actions, last: '' };
      rows.set(i.id, row);
      list.append(row.el);
    }
    row.nm.textContent = i.name;
    row.st.textContent = statusText(i);
    row.st.className = `st${i.status === 'error' ? ' err' : i.status === 'done' ? ' done' : ''}`;
    const pct = i.status === 'done' ? 100 : formatPercent(i.loaded, i.size);
    row.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    row.bar.setAttribute('aria-label', `Progression de ${i.name}`);
    row.bar.firstChild.style.width = `${pct}%`;
    row.bar.hidden = i.status === 'error' || i.status === 'canceled';
    const key = i.status + (i.retryable ? 'r' : '');
    if (row.last !== key) {
      row.last = key;
      row.actions.replaceChildren();
      if (['queued', 'uploading', 'verifying'].includes(i.status)) {
        row.actions.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `Annuler l'envoi de ${i.name}`, on: { click: () => manager.cancel(i) } }, icon('x'), h('span', { text: 'Annuler' })));
      }
      if (i.status === 'error' && i.retryable) {
        row.actions.append(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'aria-label': `Reprendre l'envoi de ${i.name}`, on: { click: () => manager.retry(i) } }, icon('refresh-cw'), h('span', { text: 'Reprendre' })));
      }
    }
  }

  const refresh = (item) => {
    for (const [id, row] of rows) if (!manager.items.some((x) => x.id === id)) { row.el.remove(); rows.delete(id); }
    manager.items.forEach(renderItem);
    root.hidden = manager.items.length === 0;
    const active = manager.items.filter((i) => ['queued', 'uploading', 'verifying'].includes(i.status)).length;
    title.textContent = active ? `Envoi en cours (${active})` : 'Envois terminés';
    if (item && ['done', 'error', 'canceled'].includes(item.status) && row(item)) live.textContent = `${item.name} : ${statusText(item)}`;
  };
  const row = (item) => rows.has(item.id);
  manager.addEventListener('change', (e) => refresh(e.detail));
  window.addEventListener('beforeunload', (e) => {
    if (manager.active) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  return { el: [root, live] };
}
