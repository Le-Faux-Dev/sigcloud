import { h, button, toast, promptDialog, confirmDialog } from '../dom.js';
import { api, errorMessage, session } from '../api.js';
import { formatBytes, formatDateTime, formatCount } from '../format.js';
import { errorState } from '../ui.js';
import { viewHead, loadingBlock } from './common.js';

export async function adminView() {
  const root = h('div', { class: 'view' }, loadingBlock());
  async function load() {
    try {
      if (session.user?.role !== 'ADMIN') throw Object.assign(new Error('Accès réservé'), { status: 403 });
      const [stats, users, audit] = await Promise.all([api.get('/admin/stats'), api.get('/admin/users?limit=100'), api.get('/admin/audit?limit=50')]);
      const stat = (n, l) => h('div', { class: 'stat' }, h('span', { class: 'n', text: formatCount(n) }), h('span', { class: 'l', text: l }));
      const rows = users.items.map((u) => h('tr', {},
        h('td', { class: 'col-name' }, h('strong', { text: u.displayName }), h('div', { class: 'sub', text: u.email })),
        h('td', { class: 'col-num', text: String(u.fileCount) }),
        h('td', { class: 'col-num', text: `${formatBytes(u.usedBytes)} / ${formatBytes(u.quotaBytes)}` }),
        h('td', { class: 'col-hide-sm', text: u.disabledAt ? 'Désactivé' : u.role === 'ADMIN' ? 'Administrateur' : 'Actif' }),
        h('td', { class: 'col-hide-sm' }, h('div', { class: 'flex gap-2' },
          button({ label: 'Quota', icon: 'gauge', cls: 'btn btn-secondary btn-sm', ariaLabel: `Modifier le quota de ${u.email}`, onClick: async () => {
            const mb = await promptDialog({ title: `Quota de ${u.email}`, label: 'Quota en Mo', value: String(Math.round(u.quotaBytes / 1e6)), validate: (x) => (/^\d{1,7}$/.test(x.trim()) ? null : 'Entre un nombre entier de Mo.') });
            if (mb === null) return;
            try { await api.patch(`/admin/users/${u.id}`, { quotaBytes: Number(mb) * 1_000_000 }); toast('Quota mis à jour.'); load(); } catch (err) { toast(errorMessage(err), { error: true }); }
          } }),
          u.id === session.user.id ? null : button({ label: u.disabledAt ? 'Réactiver' : 'Désactiver', icon: u.disabledAt ? 'user-check' : 'user-x', cls: 'btn btn-secondary btn-sm', ariaLabel: `${u.disabledAt ? 'Réactiver' : 'Désactiver'} ${u.email}`, onClick: async () => {
            if (!u.disabledAt && !(await confirmDialog({ title: 'Désactiver ce compte ?', message: `${u.email} sera déconnecté et ne pourra plus se connecter.`, confirmLabel: 'Désactiver', danger: true }))) return;
            try { await api.patch(`/admin/users/${u.id}`, { disabled: !u.disabledAt }); toast('Compte mis à jour.'); load(); } catch (err) { toast(errorMessage(err), { error: true }); }
          } })))));
      root.replaceChildren(
        viewHead('Administration', 'Vue d\'ensemble légère : comptes, quotas et journal des événements. Aucun accès au contenu des fichiers.'),
        h('div', { class: 'stat-grid' }, stat(stats.users, 'comptes'), stat(stats.files, 'fichiers'), stat(stats.pendingUploads, 'envois en attente'), stat(stats.rejectedUploads24h, 'envois refusés (24 h)'), stat(stats.auditEvents24h, 'événements (24 h)')),
        h('section', { class: 'panel', 'aria-labelledby': 'adm-users' }, h('div', { class: 'panel-head' }, h('h2', { id: 'adm-users', text: 'Comptes' }), h('span', { class: 'sub', text: `${formatBytes(stats.totalUsedBytes)} utilisés au total` })),
          h('div', { class: 'table-wrap' }, h('table', { class: 'ftable' }, h('caption', { class: 'sr-only', text: 'Comptes utilisateurs' }), h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Compte' }), h('th', { scope: 'col', class: 'col-num', text: 'Fichiers' }), h('th', { scope: 'col', class: 'col-num', text: 'Stockage' }), h('th', { scope: 'col', class: 'col-hide-sm', text: 'Statut' }), h('th', { scope: 'col', class: 'col-hide-sm', text: 'Actions' }))), h('tbody', {}, rows)))),
        h('section', { class: 'panel', 'aria-labelledby': 'adm-audit' }, h('div', { class: 'panel-head' }, h('h2', { id: 'adm-audit', text: 'Journal récent' })),
          h('div', { class: 'table-wrap' }, h('table', { class: 'ftable' }, h('caption', { class: 'sr-only', text: 'Journal des événements' }), h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Date' }), h('th', { scope: 'col', text: 'Événement' }), h('th', { scope: 'col', class: 'col-hide-sm', text: 'Cible' }))), h('tbody', {}, audit.items.map((a) => h('tr', {}, h('td', { class: 'col-meta', text: formatDateTime(a.createdAt) }), h('td', { class: 'col-name', text: a.action }), h('td', { class: 'col-hide-sm sub', text: a.targetType ? `${a.targetType} ${String(a.targetId ?? '').slice(0, 8)}` : '–' }))))))),
      );
    } catch (err) {
      root.replaceChildren(errorState(err, { retry: load }));
    }
  }
  await load();
  return { el: root, title: 'Administration' };
}
