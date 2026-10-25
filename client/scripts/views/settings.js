import { h, button, toast, saveBlob, confirmDialog, promptDialog } from '../dom.js';
import { api, errorMessage, session } from '../api.js';
import { formatDateTime } from '../format.js';
import { viewHead, loadingBlock } from './common.js';
import { errorState } from '../ui.js';

function field(id, label, input, help) {
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, help ? h('p', { class: 'help', id: `${id}-help`, text: help }) : null);
}

export async function settingsView({ shell }) {
  const root = h('div', { class: 'view' }, loadingBlock());
  async function load() {
    try {
      const user = session.user;
      const { items: sessions } = await api.get('/auth/sessions');

      // Profil
      const nameIn = h('input', { class: 'input', id: 'p-name', value: user.displayName, maxlength: '80', autocomplete: 'name', required: true });
      const pErr = h('p', { class: 'field-error', role: 'alert', hidden: true });
      const profile = h('form', { class: 'grid gap-3', novalidate: true, on: { submit: async (e) => {
        e.preventDefault(); pErr.hidden = true;
        try { await api.patch('/auth/me', { displayName: nameIn.value.trim() }); toast('Profil mis à jour.'); await shell.reloadSession(); await load(); } catch (err) { pErr.textContent = errorMessage(err); pErr.hidden = false; }
      } } }, field('p-name', 'Nom affiché', nameIn), field('p-mail', 'Adresse e-mail', h('input', { class: 'input', id: 'p-mail', value: user.email, readonly: true, 'aria-readonly': 'true' }), 'L\'adresse e-mail ne peut pas être modifiée dans cette version.'), pErr, h('div', {}, h('button', { type: 'submit', class: 'btn btn-primary', text: 'Enregistrer' })));

      // Mot de passe
      const cur = h('input', { class: 'input', id: 'pw-cur', type: 'password', autocomplete: 'current-password', required: true });
      const nw = h('input', { class: 'input', id: 'pw-new', type: 'password', autocomplete: 'new-password', required: true, minlength: '10', 'aria-describedby': 'pw-new-help' });
      const wErr = h('p', { class: 'field-error', role: 'alert', hidden: true });
      const pw = h('form', { class: 'grid gap-3', novalidate: true, on: { submit: async (e) => {
        e.preventDefault(); wErr.hidden = true;
        try { await api.post('/auth/change-password', { currentPassword: cur.value, newPassword: nw.value }); cur.value = ''; nw.value = ''; toast('Mot de passe modifié. Les autres appareils ont été déconnectés.'); await load(); } catch (err) { wErr.textContent = errorMessage(err); wErr.hidden = false; }
      } } }, field('pw-cur', 'Mot de passe actuel', cur), field('pw-new', 'Nouveau mot de passe', nw, 'Au moins 10 caractères. Une phrase de passe longue est plus sûre qu\'un mot court compliqué.'), wErr, h('div', {}, h('button', { type: 'submit', class: 'btn btn-primary', text: 'Changer le mot de passe' })));

      // Sessions
      const sessList = h('ul', { class: 'list-clean grid gap-2' }, sessions.map((s) => h('li', { class: 'share-row' },
        h('div', { class: 'min-w-0' }, h('p', { class: 'm-0 font-semibold', text: s.current ? 'Cet appareil' : 'Autre appareil' }), h('p', { class: 'sub m-0', text: `${s.userAgent ? s.userAgent.slice(0, 80) : 'Navigateur inconnu'} · dernière activité ${formatDateTime(s.lastSeenAt)}` })),
        s.current ? null : button({ label: 'Déconnecter', icon: 'log-out', cls: 'btn btn-danger-ghost btn-sm', ariaLabel: 'Déconnecter cet appareil', onClick: async () => { try { await api.delete(`/auth/sessions/${s.id}`); toast('Appareil déconnecté.'); load(); } catch (err) { toast(errorMessage(err), { error: true }); } } }))));

      const exportBtn = button({ label: 'Exporter mes données', icon: 'download', onClick: async () => {
        try { const data = await api.get('/auth/export'); saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'sig-cloud-export.json'); toast('Export téléchargé.'); } catch (err) { toast(errorMessage(err), { error: true }); }
      } });
      const delBtn = button({ label: 'Supprimer mon compte', icon: 'trash-2', cls: 'btn btn-danger', onClick: async () => {
        if (!(await confirmDialog({ title: 'Supprimer ton compte ?', message: 'Tous tes fichiers, dossiers et partages seront supprimés définitivement.', confirmLabel: 'Continuer', danger: true }))) return;
        const pwd = await promptDialog({ title: 'Confirme avec ton mot de passe', label: 'Mot de passe', type: 'password', confirmLabel: 'Supprimer définitivement', autocomplete: 'current-password' });
        if (pwd === null) return;
        try { await api.deleteWith('/auth/me', { password: pwd }); location.replace('/index.html'); } catch (err) { toast(errorMessage(err), { error: true }); }
      } });

      const section = (idv, title, ...kids) => h('section', { class: 'panel', 'aria-labelledby': idv }, h('div', { class: 'panel-head' }, h('h2', { id: idv, text: title })), h('div', { class: 'panel-pad grid gap-3' }, kids));
      root.replaceChildren(
        viewHead('Profil et sécurité', 'Ton compte, ton mot de passe et tes appareils connectés.'),
        section('s-prof', 'Profil', profile),
        section('s-pw', 'Mot de passe', pw),
        section('s-sess', 'Appareils connectés', sessList),
        section('s-data', 'Mes données', h('p', { class: 'm-0', text: 'Tu peux récupérer la liste de tes informations de compte et de tes fichiers (métadonnées) au format JSON.' }), h('div', { class: 'flex flex-wrap gap-2' }, exportBtn)),
        section('s-del', 'Zone sensible', h('p', { class: 'm-0', text: 'La suppression du compte efface tous tes fichiers et partages. Elle est irréversible.' }), h('div', {}, delBtn)),
      );
    } catch (err) {
      root.replaceChildren(errorState(err, { retry: load }));
    }
  }
  await load();
  return { el: root, title: 'Profil et sécurité' };
}
