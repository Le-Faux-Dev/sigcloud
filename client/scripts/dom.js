// Aides DOM sûres. RÈGLE : jamais d'innerHTML ni d'attribut d'événement en ligne.
// Tout texte (noms de fichiers, attributs GeoJSON/KML, messages) passe par textContent, donc reste une donnée.

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_HREF = '/assets/icons.svg#i-';

/**
 * Crée un élément.
 * attrs : class, text, on:{evt:fn}, data:{k:v}, aria:{k:v}, et attributs simples (jamais « style » ni « on* »).
 */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'on') for (const [evt, fn] of Object.entries(v)) node.addEventListener(evt, fn);
    else if (k === 'data') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (k === 'aria') for (const [ak, av] of Object.entries(v)) node.setAttribute(`aria-${ak}`, String(av));
    else if (k === 'style' || /^on/i.test(k) || k === 'innerHTML' || k === 'outerHTML') throw new Error(`Attribut interdit : ${k}`);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const clear = (node) => node.replaceChildren();

/** Icône du sprite Lucide. Décorative (aria-hidden) : le sens est toujours porté par un texte. */
export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `${ICON_HREF}${name}`);
  svg.append(use);
  return svg;
}

/** Bouton avec icône optionnelle. */
export function button({ label, icon: ic, cls = 'btn btn-secondary', onClick, type = 'button', ariaLabel, title, disabled }) {
  const b = h('button', { type, class: cls, 'aria-label': ariaLabel, title, disabled, on: onClick ? { click: onClick } : {} });
  if (ic) b.append(icon(ic));
  if (label) b.append(h('span', { text: label }));
  return b;
}

export function badge(kind, iconName, text) {
  return h('span', { class: `badge badge-${kind}` }, iconName ? icon(iconName) : null, text);
}

export function spinner(label = 'Chargement…') {
  return h('div', { class: 'empty', role: 'status' }, icon('loader-circle', 'icon-xl spin'), h('p', { text: label }));
}

// ───────── Notifications ─────────
let toastRegion;
export function toast(message, { error = false, timeout = 5000 } = {}) {
  toastRegion ??= document.getElementById('toasts');
  if (!toastRegion) return;
  const close = h('button', { type: 'button', 'aria-label': 'Fermer la notification' }, icon('x'));
  const t = h('div', { class: `toast${error ? ' toast-error' : ''}`, role: error ? 'alert' : 'status' }, icon(error ? 'triangle-alert' : 'circle-check'), h('p', { text: message }), close);
  const remove = () => t.remove();
  close.addEventListener('click', remove);
  toastRegion.append(t);
  if (timeout) setTimeout(remove, timeout);
}

// ───────── Boîtes de dialogue (élément <dialog> natif : piège à focus et Échap gérés par le navigateur) ─────────
export function openDialog({ title, body, actions = [], wide = false, onClose }) {
  const dlg = h('dialog', { class: `dialog${wide ? ' dialog-wide' : ''}`, 'aria-labelledby': 'dlg-title' });
  const closeBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer', on: { click: () => dlg.close('cancel') } }, icon('x'));
  const content = h('div', { class: 'dialog-body' }, body);
  const foot = actions.length ? h('div', { class: 'dialog-foot' }, actions) : null;
  dlg.append(h('div', { class: 'dialog-head' }, h('h2', { id: 'dlg-title', text: title }), closeBtn), content);
  if (foot) dlg.append(foot);
  const previous = document.activeElement;
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
    onClose?.(dlg.returnValue);
  });
  // Clic sur l'arrière-plan = annuler
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close('cancel');
  });
  document.body.append(dlg);
  dlg.showModal();
  return { dialog: dlg, content, foot, close: (v = 'cancel') => dlg.close(v) };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false, details }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => {
      answered = true;
      resolve(v);
      d.close(v ? 'ok' : 'cancel');
    };
    const d = openDialog({
      title,
      body: [h('p', { text: message, class: 'm-0' }), details ? h('p', { class: 'help', text: details }) : null],
      actions: [
        h('button', { type: 'button', class: 'btn btn-secondary', text: 'Annuler', on: { click: () => done(false) } }),
        h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel, on: { click: () => done(true) } }),
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    d.foot.lastChild.focus();
  });
}

/** Boîte de saisie : valide avant de fermer ; retourne la valeur ou null. */
export function promptDialog({ title, label, value = '', confirmLabel = 'Enregistrer', help, type = 'text', validate, autocomplete = 'off' }) {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('input', { class: 'input', id: 'prompt-input', type, value, autocomplete, required: true });
    const err = h('p', { class: 'field-error', role: 'alert', hidden: true });
    const form = h('form', { class: 'field', novalidate: true }, h('label', { for: 'prompt-input', text: label }), input, help ? h('p', { class: 'help', text: help }) : null, err);
    const submit = () => {
      const v = input.value;
      const problem = validate?.(v) ?? (v.trim() ? null : 'Ce champ est obligatoire.');
      if (problem) {
        err.textContent = problem;
        err.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', 'prompt-err');
        input.focus();
        return;
      }
      answered = true;
      resolve(v);
      d.close('ok');
    };
    err.id = 'prompt-err';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
    const d = openDialog({
      title,
      body: form,
      actions: [
        h('button', { type: 'button', class: 'btn btn-secondary', text: 'Annuler', on: { click: () => d.close('cancel') } }),
        h('button', { type: 'button', class: 'btn btn-primary', text: confirmLabel, on: { click: submit } }),
      ],
      onClose: () => {
        if (!answered) resolve(null);
      },
    });
    input.focus();
    input.select();
  });
}

// ───────── Menu contextuel accessible ─────────
export function openMenu(anchor, items) {
  document.querySelector('.menu')?.remove();
  const menu = h('div', { class: 'menu', role: 'menu' });
  const close = () => {
    menu.remove();
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    anchor.setAttribute('aria-expanded', 'false');
    anchor.focus();
  };
  const btns = [];
  for (const it of items) {
    if (it === '-') {
      menu.append(h('hr', { role: 'separator' }));
      continue;
    }
    const b = h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', on: { click: () => { close(); it.onClick(); } } }, icon(it.icon), h('span', { text: it.label }));
    btns.push(b);
    menu.append(b);
  }
  const onDoc = (e) => {
    if (!menu.contains(e.target) && e.target !== anchor) close();
  };
  const onKey = (e) => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      btns[(i + 1) % btns.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(i - 1 + btns.length) % btns.length].focus();
    } else if (e.key === 'Tab') close();
  };
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth || 220;
  menu.style.top = `${Math.round(window.scrollY + r.bottom + 4)}px`;
  menu.style.left = `${Math.max(8, Math.round(window.scrollX + Math.min(r.right - mw, window.innerWidth - mw - 8)))}px`;
  anchor.setAttribute('aria-expanded', 'true');
  setTimeout(() => {
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey, true);
  });
  btns[0]?.focus();
  return close;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Déclenche le téléchargement d'un Blob généré localement (export de données). */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Lecture/écriture de préférences d'affichage : jamais bloquant (stockage navigateur parfois indisponible). */
export const prefs = {
  get(key, fallback) {
    try {
      return localStorage.getItem(`sig.${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`sig.${key}`, value);
    } catch {
      /* ignoré */
    }
  },
};
