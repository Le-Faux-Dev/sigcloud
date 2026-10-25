// Contrôles statiques des pages HTML (CSP stricte, accessibilité de base). Échoue si une règle est violée.
import { readdir, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');
const pages = (await readdir(root)).filter((f) => f.endsWith('.html'));
const problems = [];
const bad = (page, msg) => problems.push(`${page}: ${msg}`);

for (const page of pages) {
  const html = await readFile(join(root, page), 'utf8');
  const { document } = new JSDOM(html).window;
  if (!/^<!doctype html>/i.test(html)) bad(page, 'doctype manquant');
  if (document.documentElement.lang !== 'fr') bad(page, 'lang="fr" manquant');
  if (!document.querySelector('meta[name="viewport"]')) bad(page, 'meta viewport manquante');
  if (!document.title.trim()) bad(page, 'titre vide');
  if (!document.querySelector('.skip-link')) bad(page, "lien d'évitement manquant");
  for (const s of document.querySelectorAll('script')) if (!s.src || s.textContent.trim()) bad(page, 'script inline');
  if (document.querySelector('style')) bad(page, 'balise <style> inline');
  for (const el of document.querySelectorAll('*')) {
    if (el.hasAttribute('style')) bad(page, `attribut style sur <${el.localName}>`);
    for (const a of el.attributes) if (/^on/i.test(a.name)) bad(page, `gestionnaire ${a.name} sur <${el.localName}>`);
  }
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
  for (const id of new Set(ids.filter((i, n) => ids.indexOf(i) !== n))) bad(page, `id dupliqué : ${id}`);
  if (document.querySelector('img:not([alt])')) bad(page, 'image sans alt');
  for (const el of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
    const labelled = el.id && document.querySelector(`label[for="${el.id}"]`);
    if (!labelled && !el.getAttribute('aria-label')) bad(page, `champ sans libellé : ${el.name || el.id}`);
  }
  const h1 = document.querySelectorAll('h1').length;
  if (h1 > 1) bad(page, `${h1} balises h1`);
  for (const el of document.querySelectorAll('[src],[href]')) {
    const u = el.getAttribute('src') ?? el.getAttribute('href');
    if (/^(https?:)?\/\//i.test(u)) bad(page, `ressource externe : ${u}`);
    else if (u.startsWith('/') && !u.startsWith('/#')) {
      try { await access(join(root, u.split('#')[0].split('?')[0] === '/' ? 'index.html' : u.split('#')[0].split('?')[0])); } catch { bad(page, `fichier introuvable : ${u}`); }
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`HTML : ${pages.length} pages contrôlées, aucun problème.`);
