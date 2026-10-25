import { h, button, toast, confirmDialog } from '../dom.js';
import { api, errorMessage } from '../api.js';
import { formatBytes, formatDate } from '../format.js';
import { fileIconBox, folderIconBox, emptyState, errorState } from '../ui.js';
import { viewHead, loadingBlock } from './common.js';

export async function trashView({ shell }) {
  const root = h('div', { class: 'view' }, loadingBlock());
  async function load() {
    try {
      const { files, folders } = await api.get('/trash');
      const act = async (fn, ok) => { try { await fn(); toast(ok); shell.refreshUsage(); await load(); } catch (err) { toast(errorMessage(err), { error: true }); } };
      const row = (kind, item) => h('li', { class: 'share-row' },
        h('div', { class: 'name-cell' }, kind === 'file' ? fileIconBox(item) : folderIconBox(), h('div', { class: 'min-w-0' }, h('p', { class: 'm-0 font-semibold', text: item.name }), h('p', { class: 'sub m-0', text: `Supprimé le ${formatDate(item.deletedAt)}${kind === 'file' ? ` · ${formatBytes(item.sizeBytes)}` : ' · dossier et contenu'}` }))),
        h('div', { class: 'flex gap-2' },
          button({ label: 'Restaurer', icon: 'undo-2', cls: 'btn btn-secondary btn-sm', ariaLabel: `Restaurer ${item.name}`, onClick: () => act(() => api.post(`/trash/${kind}s/${item.id}/restore`, {}), 'Restauré.') }),
          button({ label: 'Supprimer', icon: 'trash-2', cls: 'btn btn-danger-ghost btn-sm', ariaLabel: `Supprimer définitivement ${item.name}`, onClick: async () => {
            if (!(await confirmDialog({ title: 'Supprimer définitivement ?', message: `« ${item.name} » sera effacé pour toujours. Cette action est irréversible.`, confirmLabel: 'Supprimer définitivement', danger: true }))) return;
            act(() => api.delete(`/trash/${kind}s/${item.id}`), 'Supprimé définitivement.');
          } })));
      const total = files.length + folders.length;
      const empty = button({ label: 'Vider la corbeille', icon: 'trash-2', cls: 'btn btn-danger', onClick: async () => {
        if (!(await confirmDialog({ title: 'Vider la corbeille ?', message: `${total} élément(s) seront effacés définitivement. Cette action est irréversible.`, confirmLabel: 'Tout supprimer', danger: true }))) return;
        act(() => api.post('/trash/empty', { confirm: true }), 'Corbeille vidée.');
      } });
      root.replaceChildren(
        viewHead('Corbeille', 'Les éléments sont supprimés définitivement au bout de 30 jours.', total ? empty : null),
        total
          ? h('div', { class: 'panel panel-pad' }, h('ul', { class: 'list-clean grid gap-2' }, folders.map((f) => row('folder', f)), files.map((f) => row('file', f))))
          : h('div', { class: 'panel' }, emptyState({ iconName: 'trash-2', title: 'La corbeille est vide' })),
      );
    } catch (err) {
      root.replaceChildren(errorState(err, { retry: load }));
    }
  }
  await load();
  return { el: root, title: 'Corbeille' };
}
