import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, uniqueEmail, PASSWORD } from '../helpers.js';

let t;
before(async () => {
  t = await startTestApp();
});
after(async () => t.close());

test('routes protégées : refus sans session (401) pour toutes les familles de routes', async () => {
  const anon = t.client();
  const routes = [
    ['GET', '/auth/me'], ['GET', '/files'], ['GET', '/files/00000000-0000-4000-8000-000000000000'], ['POST', '/files/uploads'],
    ['GET', '/folders/root/contents'], ['POST', '/folders'], ['GET', '/trash'], ['GET', '/shares/with-me'], ['POST', '/shares/links'],
    ['GET', '/admin/stats'], ['GET', '/admin/users'], ['GET', '/admin/audit'], ['GET', '/auth/export'], ['GET', '/auth/sessions'],
  ];
  for (const [m, p] of routes) {
    const r = await anon.api(m, p, { json: m === 'POST' ? {} : undefined, csrf: false });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test('administration réservée aux admins (403 pour un utilisateur normal)', async () => {
  const c = t.client();
  await c.register();
  for (const p of ['/admin/stats', '/admin/users', '/admin/audit']) assert.equal((await c.get(p)).status, 403, p);
  assert.equal((await c.patch('/admin/users/00000000-0000-4000-8000-000000000000', { disabled: true })).status, 403);
});

test('l\'administrateur : stats réelles, quota, protections contre l\'auto-désactivation', async () => {
  const admin = t.client();
  const a = await admin.register();
  await t.ctx.db.user.update({ where: { id: a.id }, data: { role: 'ADMIN' } });
  const u = t.client();
  const user = await u.register();
  await u.upload({ name: 'a.txt', data: 'abcde' });
  const stats = await admin.get('/admin/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.data.users >= 2 && stats.data.files >= 1 && stats.data.totalUsedBytes >= 5);
  assert.equal((await admin.patch(`/admin/users/${a.id}`, { disabled: true })).data.error.code, 'CANNOT_DISABLE_SELF');
  assert.equal((await admin.patch(`/admin/users/${user.id}`, { quotaBytes: 2 })).data.error.code, 'QUOTA_BELOW_USAGE');
  assert.equal((await admin.patch(`/admin/users/${user.id}`, { quotaBytes: 123456 })).status, 200);
  assert.equal((await u.get('/auth/me')).data.user.quotaBytes, 123456);
  const audit = await admin.get('/admin/audit?limit=5');
  assert.equal(audit.status, 200);
  assert.ok(audit.data.items.length > 0);
});

test('CSRF : requête modifiante sans jeton ou avec un mauvais jeton refusée ; mauvaise origine refusée', async () => {
  const c = t.client();
  await c.register();
  const noToken = await c.post('/folders', { name: 'x' }, { csrf: false });
  assert.equal(noToken.status, 403);
  const wrong = await c.post('/folders', { name: 'x' }, { headers: { 'x-csrf-token': 'faux-jeton' } });
  assert.equal(wrong.status, 403);
  const evil = await c.post('/folders', { name: 'x' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const good = await c.post('/folders', { name: 'x' });
  assert.equal(good.status, 201);
  // Les lectures (GET) restent possibles sans jeton CSRF
  assert.equal((await c.get('/folders/root/contents', { csrf: false })).status, 200);
});

test('CORS restrictif : aucune origine tierce autorisée', async () => {
  const c = t.client();
  const evil = await c.raw('OPTIONS', '/api/v1/auth/me', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const get = await c.raw('GET', '/api/v1/config', { headers: { origin: 'https://evil.example' } });
  assert.equal(get.headers.get('access-control-allow-origin'), null);
  assert.notEqual(get.headers.get('access-control-allow-origin'), '*');
  const good = await c.raw('OPTIONS', '/api/v1/auth/me', { headers: { origin: t.config.appOrigin } });
  assert.equal(good.status, 204);
  assert.equal(good.headers.get('access-control-allow-origin'), t.config.appOrigin);
});

test('en-têtes de sécurité et absence de mise en cache des réponses d\'API', async () => {
  const r = await t.client().raw('GET', '/api/v1/config');
  const h = r.headers;
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.equal(h.get('referrer-policy'), 'no-referrer');
  assert.equal(h.get('x-frame-options'), 'DENY');
  assert.equal(h.get('cache-control'), 'no-store');
  assert.equal(h.get('x-powered-by'), null);
  const csp = h.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(h.get('x-request-id'));
});

test('limitation de débit : connexion (par compte) et inscription', async () => {
  const email = uniqueEmail();
  const c = t.client();
  await c.register({ email });
  let last;
  const sameIp = '203.0.113.7'; // limite par IP + compte : l'attaquant garde la même IP
  for (let i = 0; i < 10; i++) last = await t.client(sameIp).login(email, 'mauvais-mot-de-passe-9');
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
  assert.equal(last.data.error.code, 'RATE_LIMITED');
  // Le mot de passe correct est lui aussi bloqué pendant la fenêtre (protection contre l'essai de mots de passe)
  assert.equal((await t.client(sameIp).login(email)).status, 429);
  // Une autre adresse n'est pas bloquée : on ne peut pas verrouiller le compte de quelqu'un d'autre
  assert.equal((await t.client('198.51.100.9').login(email)).status, 200);
});

test('injection SQL et entrées hostiles : traitées comme des données, jamais exécutées', async () => {
  const c = t.client();
  const email = uniqueEmail();
  await c.register({ email, displayName: "Robert'); DROP TABLE users;--" });
  assert.equal((await c.get('/auth/me')).data.user.displayName, "Robert'); DROP TABLE users;--");
  assert.ok((await t.ctx.db.user.count()) > 0);
  const inj = await t.client().post('/auth/login', { email: "' OR '1'='1", password: "' OR '1'='1" });
  assert.equal(inj.status, 400);
  assert.equal((await c.get("/files?folderId=all&q=%27%3B%20DROP%20TABLE%20file_assets%3B--")).status, 200);
  assert.equal((await c.get('/files/not-a-uuid')).status, 400);
  assert.equal((await c.get('/folders/%27%20OR%201=1/contents')).status, 400);
  assert.equal((await t.client().get('/public/share', { share: "' OR 1=1 --" })).status, 404);
  assert.equal(await t.ctx.db.fileAsset.count() >= 0, true);
});

test('validation stricte : JSON invalide, champs inconnus, types inattendus, corps trop gros', async () => {
  const c = t.client();
  const r1 = await c.raw('POST', '/api/v1/auth/login', { body: '{"email":', headers: { 'content-type': 'application/json' } });
  assert.equal(r1.status, 400);
  assert.equal((await t.client().post('/auth/register', { email: 'a@b.test', password: PASSWORD, displayName: 'x', isAdmin: true })).status, 400, 'champ inconnu refusé (pas de « mass assignment »)');
  assert.equal((await t.client().post('/auth/register', { email: 'pas-un-email', password: PASSWORD, displayName: 'x' })).status, 400);
  assert.equal((await t.client().post('/auth/register', { email: uniqueEmail(), password: 'court', displayName: 'x' })).status, 400);
  assert.equal((await t.client().post('/auth/register', { email: uniqueEmail(), password: 'password123', displayName: 'x' })).data.error.code, 'WEAK_PASSWORD');
  const big = await c.raw('POST', '/api/v1/auth/login', { body: JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(200_000) }), headers: { 'content-type': 'application/json' } });
  assert.equal(big.status, 413);
});

test('inscription : le rôle ne peut pas être choisi par le client ; e-mail en double refusé', async () => {
  const email = uniqueEmail();
  const c = t.client();
  const user = await c.register({ email });
  assert.equal(user.role, 'USER');
  const dup = await t.client().post('/auth/register', { email: email.toUpperCase(), password: PASSWORD, displayName: 'Bis' });
  assert.equal(dup.status, 409);
});

test('erreurs sûres : pas de trace, pas de chemin, 404 générique', async () => {
  const c = t.client();
  const r = await c.get('/inexistant');
  assert.equal(r.status, 404);
  const text = JSON.stringify(r.data);
  assert.doesNotMatch(text, /\/home\/|node_modules|at .*\(|stack/i);
});

test('URL signée de stockage : falsifiée, expirée ou rejouée avec un autre usage → refusée', async () => {
  const c = t.client();
  await c.register();
  const f = await c.upload({ name: 'a.txt', data: 'contenu secret' });
  const { url } = (await c.get(`/files/${f.fileId}/download`)).data;
  assert.equal((await fetch(url)).status, 200);
  const u = new URL(url);
  const token = u.searchParams.get('token');
  const [body, mac] = token.split('.');
  // jeton modifié
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), key: '00/' + 'a'.repeat(32) })).toString('base64url');
  assert.equal((await fetch(`${t.baseUrl}/api/v1/_local-storage/download?token=${tampered}.${mac}`)).status, 403);
  assert.equal((await fetch(`${t.baseUrl}/api/v1/_local-storage/download?token=garbage`)).status, 403);
  assert.equal((await fetch(`${t.baseUrl}/api/v1/_local-storage/download`)).status, 403);
  // jeton de téléchargement utilisé comme jeton d'envoi
  assert.equal((await fetch(`${t.baseUrl}/api/v1/_local-storage/upload?token=${token}`, { method: 'PUT', body: 'x' })).status, 403);
  // expirée
  const expired = t.ctx.storage.verifyToken; // vérifie la logique d'expiration directement
  const payload = JSON.parse(Buffer.from(body, 'base64url'));
  assert.ok(payload.exp > Date.now());
  assert.equal(expired(`${Buffer.from(JSON.stringify({ ...payload, exp: Date.now() - 1 })).toString('base64url')}.${mac}`, 'get'), null);
  // clé de stockage devinée : aucun point d'accès public aux objets
  const directGuess = await fetch(`${t.baseUrl}/${f.fileId}`);
  assert.notEqual(directGuess.status, 200);
  const row = await t.ctx.db.fileAsset.findUnique({ where: { id: f.fileId } });
  assert.equal((await fetch(`${t.baseUrl}/${row.storageKey}`)).status === 200, false);
  assert.equal((await fetch(`${t.baseUrl}/.data/storage/${row.storageKey}`)).status === 200, false);
});

test('la clé de stockage et les secrets ne sortent dans aucune réponse d\'API', async () => {
  const c = t.client();
  await c.register();
  const f = await c.upload({ name: 'a.txt', data: 'abc' });
  const row = await t.ctx.db.fileAsset.findUnique({ where: { id: f.fileId } });
  const responses = [
    await c.get('/auth/me'), await c.get('/files?folderId=all'), await c.get(`/files/${f.fileId}`), await c.get('/folders/root/contents'),
    await c.get('/auth/sessions'), await c.get('/auth/export'), await c.get('/config'), await c.get('/trash'), await c.get('/shares/by-me'),
  ];
  const blob = JSON.stringify(responses.map((r) => r.data));
  for (const secret of [row.storageKey, t.config.appSecret, 'passwordHash', 'tokenHash', 'storageKey', 'multipartId', 'argon2']) {
    assert.equal(blob.includes(secret), false, `fuite : ${secret.slice(0, 12)}`);
  }
});

test('sessions : cookie sans Domain, révocation, liste des sessions, protection de la fixation', async () => {
  const email = uniqueEmail();
  const a = t.client();
  await a.register({ email });
  const b = t.client();
  const login = await b.login(email);
  assert.equal(login.status, 200);
  const list = await a.get('/auth/sessions');
  assert.equal(list.data.items.length, 2);
  assert.equal(list.data.items.filter((s) => s.current).length, 1);
  assert.doesNotMatch(login.headers.get('set-cookie'), /Domain=/i);
  const other = list.data.items.find((s) => !s.current);
  assert.equal((await a.delete(`/auth/sessions/${other.id}`)).status, 204);
  assert.equal((await b.get('/auth/me')).status, 401);
  // Un cookie de session forgé n'ouvre rien
  const forged = t.client();
  forged.cookies.set('sid', 'a'.repeat(43));
  assert.equal((await forged.get('/auth/me')).status, 401);
  // Le jeton en base est un hash, pas le cookie
  const dbSession = await t.ctx.db.session.findFirst({ where: { userId: a.user.id } });
  assert.notEqual(dbSession.tokenHash, a.cookies.get('sid'));
});

test('journal d\'audit : aucune donnée sensible enregistrée', async () => {
  const c = t.client();
  const email = uniqueEmail();
  await c.register({ email });
  const f = await c.upload({ name: 'a.txt', data: 'abc' });
  const link = (await c.post('/shares/links', { fileId: f.fileId, canDownload: true })).data;
  await c.get(`/files/${f.fileId}/download`);
  const logs = await t.ctx.db.auditLog.findMany({ where: { userId: c.user.id } });
  assert.ok(logs.some((l) => l.action === 'auth.register'));
  assert.ok(logs.some((l) => l.action === 'share.link_create'));
  const blob = JSON.stringify(logs, (_k, v) => (typeof v === 'bigint' ? Number(v) : v));
  for (const bad of [PASSWORD, link.token, 'argon2', 'X-Amz', 'token=', email]) assert.equal(blob.includes(bad), false, `journal : ${bad.slice(0, 10)}`);
  assert.ok(logs.every((l) => !l.ipHash || /^[a-f0-9]{32}$/.test(l.ipHash)), 'IP hachée, jamais en clair');
});

test('réinitialisation du mot de passe : jeton à usage unique, expiration, réponse identique', async () => {
  const email = uniqueEmail();
  const c = t.client();
  await c.register({ email });
  const anon = t.client();
  const known = await anon.post('/auth/password-reset/request', { email });
  const unknown = await anon.post('/auth/password-reset/request', { email: uniqueEmail('inconnu') });
  assert.equal(known.status, 202);
  assert.deepEqual(known.data, unknown.data, 'même réponse que le compte existe ou non');

  const mail = t.ctx.mailer.outbox.filter((m) => m.to === email).at(-1);
  assert.ok(mail, 'e-mail simulé envoyé');
  const token = mail.text.split('#')[1].trim();
  assert.equal(t.ctx.mailer.outbox.some((m) => m.to.startsWith('inconnu')), false);
  const stored = await t.ctx.db.passwordResetToken.findFirst({ where: { userId: c.user.id } });
  assert.notEqual(stored.tokenHash, token, 'jeton stocké sous forme de hash');

  const newPw = 'Encore-un-nouveau-mot-de-passe-9';
  assert.equal((await anon.post('/auth/password-reset/confirm', { token, password: newPw })).status, 204);
  assert.equal((await anon.post('/auth/password-reset/confirm', { token, password: newPw })).status, 400, 'usage unique');
  assert.equal((await c.get('/auth/me')).status, 401, 'toutes les sessions sont révoquées');
  assert.equal((await t.client().login(email, newPw)).status, 200);

  await anon.post('/auth/password-reset/request', { email });
  const token2 = t.ctx.mailer.outbox.filter((m) => m.to === email).at(-1).text.split('#')[1].trim();
  await t.ctx.db.passwordResetToken.updateMany({ where: { userId: c.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await anon.post('/auth/password-reset/confirm', { token: token2, password: newPw + 'x' })).status, 400, 'jeton expiré');
});

test('sans service d\'e-mail : la réinitialisation le dit clairement au lieu de faire semblant', async () => {
  const noMail = await startTestApp({ MAIL_DRIVER: 'none' });
  try {
    const r = await noMail.client().post('/auth/password-reset/request', { email: uniqueEmail() });
    assert.equal(r.status, 501);
    assert.equal(r.data.error.code, 'MAIL_NOT_CONFIGURED');
    assert.equal((await noMail.client().get('/config')).data.features.passwordResetByEmail, false);
  } finally {
    await noMail.close();
  }
});

test('export des données et suppression du compte (objets de stockage supprimés)', async () => {
  const c = t.client();
  const email = uniqueEmail();
  const user = await c.register({ email });
  const f = await c.upload({ name: 'a.txt', data: 'abc' });
  const row = await t.ctx.db.fileAsset.findUnique({ where: { id: f.fileId } });
  const exp = await c.get('/auth/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.data.files.length, 1);
  assert.equal(exp.data.profile.email, email);

  assert.equal((await c.raw('DELETE', '/api/v1/auth/me', { json: { password: 'faux' } })).status, 401);
  const del = await c.api('DELETE', '/auth/me', { json: { password: PASSWORD } });
  assert.equal(del.status, 204);
  assert.equal(await t.ctx.db.user.findUnique({ where: { id: user.id } }), null);
  assert.equal(await t.ctx.db.fileAsset.count({ where: { ownerId: user.id } }), 0);
  assert.equal(await t.ctx.storage.head(row.storageKey), null, 'objet de stockage supprimé');
  assert.equal((await c.get('/auth/me')).status, 401);
});

test('tâche planifiée : protégée par secret ; nettoie envois abandonnés, corbeille ancienne, liens et sessions expirés', async () => {
  const anon = t.client();
  assert.equal((await anon.get('/cron/cleanup')).status, 401);
  assert.equal((await anon.get('/cron/cleanup', { headers: { authorization: 'Bearer mauvais' } })).status, 403);
  assert.equal((await anon.get('/cron/cleanup', { headers: { authorization: 'Bearer ' } })).status, 401);

  const c = t.client();
  const user = await c.register();
  // envoi abandonné depuis 2 jours
  const init = await c.post('/files/uploads', { name: 'abandon.txt', size: 50 });
  await t.ctx.db.fileAsset.update({ where: { id: init.data.file.id }, data: { createdAt: new Date(Date.now() - 2 * 86400000) } });
  // fichier en corbeille depuis 40 jours
  const old = await c.upload({ name: 'vieux.txt', data: 'vieux' });
  await c.delete(`/files/${old.fileId}`);
  await t.ctx.db.fileAsset.update({ where: { id: old.fileId }, data: { deletedAt: new Date(Date.now() - 40 * 86400000) } });
  // fichier en corbeille récent : doit rester
  const recent = await c.upload({ name: 'recent.txt', data: 'recent' });
  await c.delete(`/files/${recent.fileId}`);
  const usedBefore = Number((await t.ctx.db.user.findUnique({ where: { id: user.id } })).usedBytes);
  assert.equal(usedBefore, 50 + 5 + 6);

  const run = await anon.get('/cron/cleanup', { headers: { authorization: `Bearer ${t.config.cronSecret}` } });
  assert.equal(run.status, 200);
  assert.equal(run.data.results.abandonedUploads.purged >= 1, true);
  assert.equal(await t.ctx.db.fileAsset.findUnique({ where: { id: init.data.file.id } }), null);
  assert.equal(await t.ctx.db.fileAsset.findUnique({ where: { id: old.fileId } }), null);
  assert.notEqual(await t.ctx.db.fileAsset.findUnique({ where: { id: recent.fileId } }), null);
  assert.equal(Number((await t.ctx.db.user.findUnique({ where: { id: user.id } })).usedBytes), 6, 'quota libéré');
});
