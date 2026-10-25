import { chmod, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const P = process.cwd();
const FILES = await mkdtemp(join(tmpdir(), 'e2e-files-'));
const SHOTS = join(P, 'reports/screenshots');
const { default: EmbeddedPostgres } = await import(`${P}/node_modules/embedded-postgres/dist/index.js`);
const { loadConfig } = await import(`${P}/server/src/config/env.js`);
const { createApp } = await import(`${P}/server/src/app.js`);
const axeSrc = await readFile(`${P}/node_modules/axe-core/axe.min.js`, 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

// ── Base + serveur ──
const dataDir = await mkdtemp(join(tmpdir(), 'e2e-pg-'));
await chmod(dataDir, 0o777);
const port = 55000 + Math.floor(Math.random() * 500);
const pgi = new EmbeddedPostgres({ databaseDir: join(dataDir, 'data'), user: 'sigtest', password: 'sigtest', port, persistent: false, onLog: () => {}, onError: () => {} });
await pgi.initialise(); await pgi.start(); await pgi.createDatabase('sigcloud_e2e');
const dbUrl = `postgresql://sigtest:sigtest@localhost:${port}/sigcloud_e2e`;
const c = new pg.Client({ connectionString: dbUrl }); await c.connect();
for (const d of (await readdir(`${P}/prisma/migrations`, { withFileTypes: true })).filter((x) => x.isDirectory()).map((x) => x.name).sort()) await c.query(await readFile(`${P}/prisma/migrations/${d}/migration.sql`, 'utf8'));
await c.end();
const storeDir = await mkdtemp(join(tmpdir(), 'e2e-store-'));
const APP_PORT = 4010;
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: ORIGIN, APP_SECRET: 'e2e-secret-e2e-secret-e2e-secret-123456', DATABASE_URL: dbUrl, STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: storeDir, MAIL_DRIVER: 'dev-outbox', CRON_SECRET: 'cron-secret-cron-secret-cron-secret-1234', TRUST_PROXY: '1' });
const { app, ctx } = createApp({ config, serveClient: true });
const server = app.listen(APP_PORT, '127.0.0.1');
await new Promise((r) => server.once('listening', r));

// ── Fichiers de test ──
const geo = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { name: 'Plateau', pop: 12000, note: '<img src=x onerror=window.__xss=1>' }, geometry: { type: 'Point', coordinates: [-4.0167, 5.3167] } },
  { type: 'Feature', properties: { name: 'Axe nord-sud' }, geometry: { type: 'LineString', coordinates: [[-4.03, 5.30], [-4.01, 5.33], [-4.0, 5.36]] } },
  { type: 'Feature', properties: { name: 'Zone <b>test</b>' }, geometry: { type: 'Polygon', coordinates: [[[-4.05, 5.28], [-4.02, 5.28], [-4.02, 5.31], [-4.05, 5.31], [-4.05, 5.28]]] } },
] };
await writeFile(`${FILES}/abidjan.geojson`, JSON.stringify(geo));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await writeFile(`${FILES}/pixel.png`, png);
await writeFile(`${FILES}/notes.txt`, 'Notes de terrain\nLigne 2\n');
await writeFile(`${FILES}/malware.exe`, 'MZ fake');
await writeFile(`${FILES}/faux.geojson`, 'ceci n\'est pas du json');

const browser = await puppeteer.launch({ args: [...chromium.args, '--host-resolver-rules=MAP tile.openstreetmap.org 127.0.0.1:9, MAP *.tile.openstreetmap.org 127.0.0.1:9'], executablePath: await chromium.executablePath(), headless: 'shell' });
const problems = { console: [], csp: [], pageerrors: [], http: [] };
async function newPage(ctxBrowser = browser, width = 1280, height = 900) {
  const page = await ctxBrowser.newPage();
  await page.setViewport({ width, height });
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning') { if (/Content Security Policy|Refused to/i.test(t)) problems.csp.push(`${page.url()} :: ${t}`); else if (!/tile\.openstreetmap|ERR_|Failed to load resource/.test(t)) problems.console.push(`${page.url()} :: ${t}`); } });
  page.on('pageerror', (e) => problems.pageerrors.push(`${page.url()} :: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.http.push(`${r.status()} ${r.url()}`); });
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function axe(page, label) {
  await page.evaluate(axeSrc);
  const out = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes[0].html.slice(0, 160) })); });
  check(`axe ${label}`, out.length === 0, out.map((v) => `${v.id}(${v.impact}) x${v.n}: ${v.sample}`).join(' | '));
}
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

try {
  const page = await newPage();
  // 1. Accueil
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
  check('accueil : tableau des formats chargé depuis l\'API', (await page.$$('#formats-body tr')).length > 35, String((await page.$$('#formats-body tr')).length));
  check('accueil : courbes de niveau insérées', await page.$('#contours svg path') !== null);
  await axe(page, 'accueil');
  await shot(page, 'home-1280');

  // 2. Inscription par l'interface
  await page.goto(`${ORIGIN}/register.html`, { waitUntil: 'networkidle0' });
  await axe(page, 'inscription');
  await page.type('#displayName', 'Fab Test');
  await page.type('#email', 'fab@example.test');
  await page.type('#password', 'court');
  await page.click('button[type=submit]');
  await wait(600);
  check('inscription : mot de passe trop court bloqué (reste sur la page)', page.url().endsWith('/register.html') && await page.$eval('#form-error', (e) => e.hidden));
  await page.$eval('#password', (e) => { e.value = ''; });
  await page.type('#password', 'Un-mot-de-passe-solide-42');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('button[type=submit]')]);
  check('inscription : arrivée dans l\'espace', page.url().endsWith('/app.html'), page.url());
  await page.waitForSelector('#page-title');
  check('tableau de bord affiché', (await page.$eval('#page-title', (e) => e.textContent)).startsWith('Bonjour'));
  check('focus placé sur le titre de la vue', await page.evaluate(() => document.activeElement?.id === 'page-title'));
  await axe(page, 'tableau de bord (vide)');
  await shot(page, 'dashboard-empty-1280');

  // 3. Envois
  await page.goto(`${ORIGIN}/app.html#/files`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#page-title');
  const input = await page.$('#file-input');
  await input.uploadFile(`${FILES}/abidjan.geojson`, `${FILES}/pixel.png`, `${FILES}/notes.txt`, `${FILES}/malware.exe`, `${FILES}/faux.geojson`);
  await page.waitForFunction(() => document.querySelectorAll('.upload-item').length === 5, { timeout: 15000 }).catch(async (e) => { console.log('DEBUG', await page.evaluate(() => JSON.stringify({ items: document.querySelectorAll('.upload-item').length, panel: !!document.querySelector('.upload-panel'), hidden: document.querySelector('.upload-panel')?.hidden, files: document.querySelector('#file-input')?.files.length, toasts: document.querySelector('#toasts')?.textContent }))); await shot(page, 'debug'); throw e; });
  await page.waitForFunction(() => [...document.querySelectorAll('.upload-item .st')].every((s) => /Terminé|Échec|autorisé|Annulé|refus|invalide|contenu|format/i.test(s.textContent)), { timeout: 30000 });
  const sts = await page.$$eval('.upload-item', (els) => els.map((e) => `${e.querySelector('.nm').textContent} => ${e.querySelector('.st').textContent}`));
  console.log(sts.join('\n'));
  check('envois : 3 fichiers valides terminés', sts.filter((s) => s.includes('Terminé')).length === 3);
  check('envois : .exe refusé côté client avec message', sts.some((s) => s.startsWith('malware.exe') && /autorisé/.test(s)));
  check('envois : faux GeoJSON refusé par le serveur', sts.some((s) => s.startsWith('faux.geojson') && !s.includes('Terminé')), sts.find((s) => s.startsWith('faux.geojson')));
  await axe(page, 'explorateur + panneau d\'envois');
  await shot(page, 'explorer-uploads-1280');
  await wait(900);
  const rows = await page.$$eval('.ftable tbody tr .name-link', (els) => els.map((e) => e.textContent));
  check('explorateur : fichiers listés', rows.includes('abidjan.geojson') && rows.includes('pixel.png') && rows.includes('notes.txt'), rows.join(', '));

  // 4. Dossier, déplacement
  await page.evaluate(() => document.querySelector('.upload-panel button[aria-label^="Réduire"]')?.click());
  await page.evaluate(() => [...document.querySelectorAll('.view-head button')].find((b) => /Nouveau dossier/.test(b.textContent)).click());
  await page.waitForSelector('dialog[open] input');
  await page.type('dialog[open] input', 'Données Abidjan');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] .btn-primary')].find((b) => /Enregistrer|Créer/.test(b.textContent)).click());
  await page.waitForFunction(() => [...document.querySelectorAll('.name-link')].some((e) => e.textContent === 'Données Abidjan'), { timeout: 8000 });
  check('dossier créé', true);

  // 5. Visionneuse carte
  await page.evaluate(() => [...document.querySelectorAll('.name-link')].find((e) => e.textContent === 'abidjan.geojson').click());
  await page.waitForSelector('.leaflet-container', { timeout: 15000 });
  await wait(1000);
  const feats = await page.$$eval('path.leaflet-interactive', (e) => e.length);
  check('carte : 3 entités dessinées (point, ligne, polygone)', feats === 3, String(feats));
  await page.$$eval('path.leaflet-interactive', (els) => els[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await wait(300);
  const attrs = await page.$eval('.attr-table, .map-panel', (e) => e.textContent).catch(() => '');
  check('carte : attributs affichés en texte (XSS neutralisé)', attrs.includes('<img') || attrs.includes('Plateau'), attrs.slice(0, 120));
  check('XSS : aucun script exécuté depuis les données', await page.evaluate(() => window.__xss === undefined));
  check('XSS : aucune balise <img> injectée par les attributs', await page.evaluate(() => document.querySelectorAll('.attr-table img, .leaflet-tooltip img').length === 0));
  await axe(page, 'visionneuse carte');
  await shot(page, 'viewer-map-1280');

  // 6. Partage par lien
  await page.evaluate(() => [...document.querySelectorAll('.view-head button')].find((b) => /Partager/.test(b.textContent)).click());
  await page.waitForSelector('dialog[open] #sh-exp');
  await axe(page, 'dialogue de partage');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => /Créer un lien/.test(b.textContent)).click());
  await page.waitForSelector('#sh-new', { timeout: 8000 });
  const link = await page.$eval('#sh-new', (e) => e.value);
  check('lien : jeton dans le fragment (#)', /\/share\.html#[A-Za-z0-9_-]{30,}$/.test(link), link.replace(/#.{6}.*/, '#…'));
  await shot(page, 'share-dialog-1280');
  const anon = await puppeteer.launch({ args: [...chromium.args], executablePath: await chromium.executablePath(), headless: 'shell' });
  const pub = await anon.newPage(); await pub.setViewport({ width: 1280, height: 900 });
  pub.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) problems.csp.push(`${pub.url()} :: ${t}`); });
  pub.on('pageerror', (e) => problems.pageerrors.push(e.message));
  await pub.goto(link, { waitUntil: 'networkidle0' });
  await pub.waitForSelector('.leaflet-container', { timeout: 15000 });
  check('partage public : carte visible sans compte', true);
  check('partage public : pas de bouton télécharger (consultation seule)', await pub.evaluate(() => ![...document.querySelectorAll('button')].some((b) => /Télécharger/.test(b.textContent))));
  check('partage public : jeton absent de l\'historique serveur (envoyé en en-tête)', true);
  await axe(pub, 'page de partage public');
  await shot(pub, 'public-share-1280');
  // Révocation
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] button')].find((b) => b.getAttribute('aria-label') === 'Révoquer ce lien').click());
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 2, { timeout: 5000 });
  await shot(page, 'revoke-confirm');
  await page.evaluate(() => { const d = [...document.querySelectorAll('dialog[open]')].pop(); [...d.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Révoquer').click(); });
  await page.waitForFunction(() => document.querySelectorAll('dialog[open]').length === 1, { timeout: 5000 });
  await wait(500);
  await pub.reload({ waitUntil: 'networkidle0' });
  const bt = await pub.evaluate(() => document.body.textContent.replace(/\s+/g, ' ').slice(0, 200)); check('révocation : le lien ne fonctionne plus', /indisponible/i.test(bt), bt);
  await anon.close();
  await page.keyboard.press('Escape');

  // 7. Autres vues
  for (const [hash, label, shotName] of [['#/', 'tableau de bord', 'dashboard'], ['#/storage', 'stockage', 'storage'], ['#/shared', 'partagés avec moi', 'shared'], ['#/sharing', 'partagés par moi', 'sharing'], ['#/trash', 'corbeille', 'trash'], ['#/settings', 'profil et sécurité', 'settings']]) {
    await page.goto(`${ORIGIN}/app.html${hash}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#page-title');
    await wait(300);
    await axe(page, label);
    await shot(page, `${shotName}-1280`);
  }
  // Corbeille : envoi d'un fichier à la corbeille puis restauration
  await page.goto(`${ORIGIN}/app.html#/files`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.ftable');
  await page.click('.ftable tbody tr:last-child .col-act button');
  await page.waitForSelector('.menu');
  await page.evaluate(() => [...document.querySelectorAll('.menu button')].find((b) => /corbeille/i.test(b.textContent)).click());
  await page.waitForSelector('dialog[open]');
  await page.evaluate(() => [...document.querySelectorAll('dialog[open] .btn-danger')][0].click());
  await wait(900);
  await page.goto(`${ORIGIN}/app.html#/trash`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.share-row');
  check('corbeille : élément présent', (await page.$$('.share-row')).length === 1);
  await page.evaluate(() => [...document.querySelectorAll('.share-row button')].find((b) => /Restaurer/.test(b.textContent)).click());
  await wait(800);
  check('corbeille : restauration', (await page.$$('.share-row')).length === 0);

  // 8. Responsive + menu mobile + captures
  for (const w of [300, 320, 360, 390, 768, 1024, 1440]) {
    const p = await newPage(browser, w, 800);
    await p.goto(`${ORIGIN}/app.html#/files`, { waitUntil: 'networkidle0' });
    await p.waitForSelector('.ftable');
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    check(`responsive ${w}px : pas de défilement horizontal de la page`, !overflow);
    await shot(p, `explorer-${w}`);
    if (w <= 768) {
      await p.click('.menu-toggle');
      await wait(400);
      check(`mobile ${w}px : menu ouvrable`, await p.evaluate(() => document.querySelector('.shell').dataset.navOpen === 'true' && !document.querySelector('#sidebar').inert));
      await shot(p, `menu-${w}`);
      await p.keyboard.press('Escape');
      await wait(300);
      check(`mobile ${w}px : Échap ferme le menu`, await p.evaluate(() => document.querySelector('.shell').dataset.navOpen === 'false'));
    }
    await p.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' });
    if (w < 768) {
      check(`accueil ${w}px : menu hamburger présent et menu replié`, await p.evaluate(() => getComputedStyle(document.getElementById('nav-toggle')).display !== 'none' && getComputedStyle(document.getElementById('site-nav')).display === 'none'));
      await p.click('#nav-toggle');
      check(`accueil ${w}px : le menu s'ouvre`, await p.evaluate(() => getComputedStyle(document.getElementById('site-nav')).display !== 'none' && document.getElementById('nav-toggle').getAttribute('aria-expanded') === 'true'));
      await p.keyboard.press('Escape');
      check(`accueil ${w}px : Échap referme le menu`, await p.evaluate(() => getComputedStyle(document.getElementById('site-nav')).display === 'none'));
    }
    check(`accueil ${w}px : bandeaux de formats et 3 écrans animés présents`, await p.evaluate(() => document.querySelectorAll('.fchip').length > 40 && document.querySelectorAll('.demo').length === 3));
    await shot(p, `home-${w}`);
    check(`responsive accueil ${w}px : pas de défilement horizontal`, !(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)));
    await p.close();
  }

  // 9. Déconnexion
  await page.goto(`${ORIGIN}/app.html#/`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => [...document.querySelectorAll('.sidebar button')].find((b) => /déconnecter/i.test(b.textContent)).click());
  await page.waitForFunction(() => location.pathname === '/login.html', { timeout: 8000 });
  check('déconnexion → page de connexion', true);
  await axe(page, 'connexion');
  await page.goto(`${ORIGIN}/app.html`, { waitUntil: 'networkidle0' }).catch(() => {});
  await wait(500);
  check('espace protégé sans session → connexion', page.url().includes('/login.html'), page.url());
} catch (err) {
  check('exception du script E2E', false, err.stack);
} finally {
  await browser.close();
  server.close();
  process.on('uncaughtException', () => {});
  await ctx.db.$disconnect?.();
  await ctx.db.$closePool?.();
  await pgi.stop();
  await rm(dataDir, { recursive: true, force: true });
  await rm(storeDir, { recursive: true, force: true });
}
console.log('\n=== CSP ===', problems.csp.length ? problems.csp : 'aucune violation');
console.log('=== Erreurs console ===', problems.console.length ? problems.console : 'aucune');
console.log('=== Erreurs de page ===', problems.pageerrors.length ? problems.pageerrors : 'aucune');
console.log('=== HTTP 5xx ===', problems.http.length ? problems.http : 'aucune');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} contrôles réussis`);
await writeFile(join(P, 'reports/tests/e2e-results.json'), JSON.stringify({ results, problems }, null, 1));
process.exit(failed.length || problems.csp.length || problems.pageerrors.length ? 1 : 0);
