// En-tête des pages publiques : menu « hamburger » sur petit écran (sans JavaScript, le menu reste visible).
const header = document.getElementById('site-header');
const toggle = document.getElementById('nav-toggle');
const nav = document.getElementById('site-nav');
if (header && toggle && nav) {
  document.documentElement.dataset.js = '1';
  const set = (open, focusBack = false) => {
    header.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    if (!open && focusBack) toggle.focus();
  };
  toggle.addEventListener('click', () => set(header.dataset.open !== 'true'));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && header.dataset.open === 'true') set(false, true); });
  document.addEventListener('click', (e) => { if (header.dataset.open === 'true' && !header.contains(e.target)) set(false); });
  window.matchMedia('(min-width: 48rem)').addEventListener('change', () => set(false));
  set(false);
}
