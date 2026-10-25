import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, uniqueEmail, PASSWORD } from '../helpers.js';

let t;
before(async () => {
  t = await startTestApp();
});
after(async () => t.close());

test('inscription, session par cookie HttpOnly, /me et déconnexion', async () => {
  const c = t.client();
  const email = uniqueEmail();
  const r = await c.post('/auth/register', { email, password: PASSWORD, displayName: 'Awa' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.email, email);
  assert.ok(r.data.csrfToken);
  assert.equal(r.data.user.passwordHash, undefined, 'le hash ne doit jamais sortir');
  const setCookie = r.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  c.csrf = r.data.csrfToken;

  const me = await c.get('/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, email);
  assert.equal(me.data.user.quotaBytes, t.config.limits.defaultQuotaBytes);

  const out = await c.post('/auth/logout', {});
  assert.equal(out.status, 204);
  const after = await c.get('/auth/me');
  assert.equal(after.status, 401);
});

test('connexion : mauvais mot de passe et compte inconnu donnent la même réponse', async () => {
  const c = t.client();
  const email = uniqueEmail();
  await c.register({ email });
  const bad = await t.client().login(email, 'mauvais-mot-de-passe-1');
  const unknown = await t.client().login(uniqueEmail('inconnu'), 'mauvais-mot-de-passe-1');
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual({ code: bad.data.error.code, message: bad.data.error.message }, { code: unknown.data.error.code, message: unknown.data.error.message });
  const ok = await t.client().login(email);
  assert.equal(ok.status, 200);
});
