import { h, button, toast, confirmDialog } from '../dom.js';
import { api, errorMessage } from '../api.js';
import { formatBytes, formatDate } from '../format.js';
import { fileIconBox, folderIconBox, emptyState, errorState } from '../ui.js';
import { viewHead, loadingBlock } from './common.js';

export async function sharedWithMeView() {
  const root = h('div', { class: 'view' }, loadingBlock());
  async function load() {
    try {
      const { items } = await api.get('/shares/with-me');
      const list = items.length
        ? h('ul', { class: 'list-clean grid gap-2' }, items.map((it) => h('li', { class: 'share-row' },
            h('div', { class: 'name-cell' }, it.kind === 'file' ? fileIconBox(it.file) : folderIconBox(),
              h('div', { class: 'min-w-0' },
                h('a', { class: 'name-link', href: it.kind === 'file' ? `#/file/${it.file.id}` : `#/files/${it.folder.id}`, text: it.kind === 'file' ? it.file.name : it.folder.name }),
                h('p', { class: 'sub m-0', text: `Partagé par ${it.ownerName} le ${formatDate(it.sharedAt)} · ${it.canDownload ? 'consultation et téléchargement' : 'consultation seule'}${it.kind === 'file' ? ` · ${formatBytes(it.file.sizeBytes)}` : ' · dossier'}` }))),
            button({ label: 'Quitter', icon: 'log-out', cls: 'btn btn-ghost btn-sm', ariaLabel: `Quitter le partage de ${it.kind === 'file' ? it.file.name : it.folder.name}`, onClick: async () => {
              if (!(await confirmDialog({ title: 'Quitter ce partage ?', message: 'Tu ne verras plus ce contenu. Son propriétaire pourra te le repartager.', confirmLabel: 'Quitter' }))) return;
              try { await api.delete(`/shares/grants/${it.grantId}`); toast('Partage quitté.'); load(); } catch (err) { toast(errorMessage(err), { error: true }); }
            } }))))
        : emptyState({ iconName: 'users', title: 'Rien n\'est partagé avec toi', text: 'Quand quelqu\'un partage un fichier ou un dossier avec ton adresse e-mail, il apparaît ici.' });
      root.replaceChildren(viewHead('Partagés avec moi', 'Fichiers et dossiers que d\'autres personnes t\'ont ouverts.'), h('div', { class: 'panel panel-pad' }, list));
    } catch (err) {
      root.replaceChildren(errorState(err, { retry: load }));
    }
  }
  await load();
  return { el: root, title: 'Partagés avec moi' };
}

export async function sharedByMeView() {
  const root = h('div', { class: 'view' }, loadingBlock());
  async function load() {
    try {
      const { links, grants } = await api.get('/shares/by-me');
      const status = (l) => (l.status === 'expired' ? ' · expiré' : '');
      const linkList = links.length
        ? h('ul', { class: 'list-clean grid gap-2' }, links.map((l) => h('li', { class: 'share-row' },
            h('div', { class: 'min-w-0' }, h('p', { class: 'm-0 font-semibold', text: l.targetName }), h('p', { class: 'sub m-0', text: `Lien ${l.canDownload ? 'avec téléchargement' : 'en consultation seule'} · créé le ${formatDate(l.createdAt)} · ${l.expiresAt ? `expire le ${formatDate(l.expiresAt)}` : 'sans expiration'}${status(l)}` })),
            button({ label: 'Révoquer', icon: 'link-2-off', cls: 'btn btn-danger-ghost btn-sm', ariaLabel: `Révoquer le lien de ${l.targetName}`, onClick: async () => {
              if (!(await confirmDialog({ title: 'Révoquer ce lien ?', message: 'Toute personne qui possède ce lien perdra l\'accès immédiatement.', confirmLabel: 'Révoquer', danger: true }))) return;
              try { await api.delete(`/shares/links/${l.id}`); toast('Lien révoqué.'); load(); } catch (err) { toast(errorMessage(err), { error: true }); }
            } }))))
        : h('p', { class: 'sub m-0', text: 'Aucun lien actif.' });
      const grantList = grants.length
        ? h('ul', { class: 'list-clean grid gap-2' }, grants.map((g) => h('li', { class: 'share-row' },
            h('div', { class: 'min-w-0' }, h('p', { class: 'm-0 font-semibold', text: g.targetName }), h('p', { class: 'sub m-0', text: `Avec ${g.displayName ? `${g.displayName} (${g.email})` : g.email} · ${g.canDownload ? 'consultation et téléchargement' : 'consultation seule'}` })),
            button({ label: 'Retirer', icon: 'user-minus', cls: 'btn btn-danger-ghost btn-sm', ariaLabel: `Retirer l'accès de ${g.email} à ${g.targetName}`, onClick: async () => {
              try { await api.delete(`/shares/grants/${g.id}`); toast('Accès retiré.'); load(); } catch (err) { toast(errorMessage(err), { error: true }); }
            } }))))
        : h('p', { class: 'sub m-0', text: 'Aucun partage avec des personnes.' });
      root.replaceChildren(
        viewHead('Partagés par moi', 'Tout ce que tu as ouvert à d\'autres. Révoque un accès à tout moment.'),
        h('section', { class: 'panel', 'aria-labelledby': 'by-links' }, h('div', { class: 'panel-head' }, h('h2', { id: 'by-links', text: 'Liens de partage' })), h('div', { class: 'panel-pad' }, linkList)),
        h('section', { class: 'panel', 'aria-labelledby': 'by-people' }, h('div', { class: 'panel-head' }, h('h2', { id: 'by-people', text: 'Personnes' })), h('div', { class: 'panel-pad' }, grantList)),
      );
    } catch (err) {
      root.replaceChildren(errorState(err, { retry: load }));
    }
  }
  await load();
  return { el: root, title: 'Partagés par moi' };
}
