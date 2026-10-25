import { h, icon, button, openDialog, confirmDialog, toast, copyText } from './dom.js';
import { api, errorMessage } from './api.js';
import { formatDate } from './format.js';

const EXPIRY = [
  { v: '7', t: '7 jours' },
  { v: '30', t: '30 jours' },
  { v: '90', t: '90 jours' },
  { v: '', t: 'Sans expiration' },
];

/** Dialogue de partage d'un fichier ou d'un dossier : lien (vue / téléchargement) et personnes (par e-mail). */
export function openShareDialog({ kind, id, name, onChange }) {
  const key = kind === 'file' ? { fileId: id } : { folderId: id };
  const body = h('div', { class: 'grid gap-5' });
  const linksBox = h('div', { class: 'grid gap-3' });
  const grantsBox = h('div', { class: 'grid gap-3' });
  const fresh = h('div', { 'aria-live': 'polite' });
  const error = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const fail = (err) => {
    error.textContent = errorMessage(err);
    error.hidden = false;
  };

  // ── Lien ──
  const dl = h('input', { type: 'checkbox', id: 'sh-dl' });
  const exp = h('select', { class: 'input select', id: 'sh-exp' }, EXPIRY.map((o) => h('option', { value: o.v, text: o.t, selected: o.v === '30' })));
  const createLink = button({
    label: 'Créer un lien',
    icon: 'link',
    cls: 'btn btn-primary',
    onClick: async (e) => {
      const btn = e.currentTarget;
      error.hidden = true;
      btn.disabled = true;
      try {
        const out = await api.post('/shares/links', { ...key, canDownload: dl.checked, expiresInDays: exp.value ? Number(exp.value) : null });
        // Le lien contient le jeton dans le fragment (#) : il n'est jamais envoyé au serveur par le navigateur.
        const url = out.url;
        const input = h('input', { class: 'input', readonly: true, value: url, 'aria-label': 'Lien de partage', id: 'sh-new' });
        fresh.replaceChildren(
          h('div', { class: 'notice' }, icon('link'), h('div', { class: 'grid gap-2' }, h('p', { text: 'Lien créé. Copie-le maintenant : pour ta sécurité, il ne sera plus affiché en entier ensuite.' }), input, button({ label: 'Copier le lien', icon: 'copy', cls: 'btn btn-secondary btn-sm', onClick: async () => toast((await copyText(url)) ? 'Lien copié.' : 'Copie impossible : sélectionne le lien et copie-le.', { error: false }) }))),
        );
        input.select();
        await refresh();
        onChange?.();
      } catch (err) {
        fail(err);
      } finally {
        btn.disabled = false;
      }
    },
  });

  // ── Personnes ──
  const email = h('input', { class: 'input', id: 'sh-email', type: 'email', autocomplete: 'off', placeholder: 'prenom@exemple.com', 'aria-describedby': 'sh-email-help' });
  const gdl = h('input', { type: 'checkbox', id: 'sh-gdl' });
  const grantForm = h(
    'form',
    { class: 'grid gap-3', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'sh-email', text: 'Adresse e-mail de la personne' }), email, h('p', { class: 'help', id: 'sh-email-help', text: 'Elle verra ce contenu dans « Partagés avec moi » après connexion. Par prudence, nous ne disons pas si l\'adresse a un compte.' })),
    h('label', { class: 'check', for: 'sh-gdl' }, gdl, h('span', { text: 'Autoriser aussi le téléchargement (sinon : consultation seule)' })),
    h('div', {}, h('button', { type: 'submit', class: 'btn btn-secondary' }, icon('user-plus'), h('span', { text: 'Partager avec cette personne' }))),
  );
  grantForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    try {
      await api.post('/shares/grants', { ...key, email: email.value.trim(), canDownload: gdl.checked });
      toast('Partage enregistré.');
      email.value = '';
      await refresh();
      onChange?.();
    } catch (err) {
      fail(err);
    }
  });

  const rowFor = (text, sub, onRemove, removeLabel) =>
    h('li', { class: 'share-row' }, h('div', { class: 'min-w-0' }, h('p', { class: 'm-0 font-semibold', text }), h('p', { class: 'sub m-0', text: sub })), button({ label: 'Retirer', icon: 'trash-2', cls: 'btn btn-danger-ghost btn-sm', ariaLabel: removeLabel, onClick: onRemove }));

  async function refresh() {
    try {
      const data = await api.get(`/shares?${new URLSearchParams(key)}`);
      linksBox.replaceChildren(
        data.links.length
          ? h('ul', { class: 'list-clean grid gap-2' }, data.links.map((l) => rowFor(`Lien ${l.canDownload ? 'avec téléchargement' : 'en consultation seule'}`, `Créé le ${formatDate(l.createdAt)} · ${l.expiresAt ? `expire le ${formatDate(l.expiresAt)}` : 'sans expiration'}${l.status === 'expired' ? ' · expiré' : ''}`, async () => {
              if (!(await confirmDialog({ title: 'Révoquer ce lien ?', message: 'Toute personne qui possède ce lien perdra l\'accès immédiatement.', confirmLabel: 'Révoquer', danger: true }))) return;
              try { await api.delete(`/shares/links/${l.id}`); toast('Lien révoqué.'); await refresh(); onChange?.(); } catch (err) { fail(err); }
            }, 'Révoquer ce lien')))
          : h('p', { class: 'sub m-0', text: 'Aucun lien actif. Par défaut, ce contenu est privé.' }),
      );
      grantsBox.replaceChildren(
        data.grants.length
          ? h('ul', { class: 'list-clean grid gap-2' }, data.grants.map((g) => rowFor(g.displayName ? `${g.displayName} (${g.email})` : g.email, g.canDownload ? 'Peut consulter et télécharger' : 'Peut consulter seulement', async () => {
              try { await api.delete(`/shares/grants/${g.id}`); toast('Accès retiré.'); await refresh(); onChange?.(); } catch (err) { fail(err); }
            }, `Retirer l'accès de ${g.email}`)))
          : h('p', { class: 'sub m-0', text: 'Personne d\'autre n\'a accès pour le moment.' }),
      );
    } catch (err) {
      fail(err);
    }
  }

  body.append(
    h('p', { class: 'm-0', text: kind === 'file' ? `Fichier : ${name}` : `Dossier : ${name} (tout son contenu, y compris les futurs ajouts)` }),
    error,
    h('section', { class: 'grid gap-3', 'aria-labelledby': 'sh-h-link' },
      h('h3', { id: 'sh-h-link', text: 'Partager avec un lien' }),
      h('p', { class: 'help m-0', text: 'Toute personne qui a le lien peut ouvrir ce contenu, sans compte. Ne l\'envoie qu\'aux personnes concernées.' }),
      h('div', { class: 'field' }, h('label', { for: 'sh-exp', text: 'Durée de validité' }), exp),
      h('label', { class: 'check', for: 'sh-dl' }, dl, h('span', { text: 'Autoriser le téléchargement (sinon : consultation seule)' })),
      h('div', {}, createLink),
      fresh,
      linksBox),
    h('hr', { class: 'rule' }),
    h('section', { class: 'grid gap-3', 'aria-labelledby': 'sh-h-people' }, h('h3', { id: 'sh-h-people', text: 'Partager avec des personnes' }), grantForm, grantsBox),
  );
  const d = openDialog({ title: 'Partager', body, wide: true, actions: [h('button', { type: 'button', class: 'btn btn-primary', text: 'Terminé', on: { click: () => d.close('ok') } })] });
  refresh();
  return d;
}
