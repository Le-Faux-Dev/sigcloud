import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, geojsonSample, uniqueEmail, PASSWORD } from '../helpers.js';

let t;
before(async () => {
  t = await startTestApp();
});
after(async () => t.close());

async function setup() {
  const owner = t.client();
  await owner.register({ displayName: 'Propriétaire' });
  const other = t.client();
  await other.register({ displayName: 'Autre' });
  const file = await owner.upload({ name: 'carte.geojson', data: geojsonSample() });
  return { owner, other, fileId: file.fileId };
}

test('IDOR : un autre utilisateur ne peut ni lire, ni modifier, ni supprimer, ni télécharger, ni partager le fichier', async () => {
  const { owner, other, fileId } = await setup();
  const folder = (await owner.post('/folders', { name: 'Privé' })).data.folder;

  assert.equal((await other.get(`/files/${fileId}`)).status, 404);
  assert.equal((await other.get(`/files/${fileId}/download`)).status, 404);
  assert.equal((await other.get(`/files/${fileId}/preview`)).status, 404);
  assert.equal((await other.patch(`/files/${fileId}`, { name: 'pirate.geojson' })).status, 404);
  assert.equal((await other.delete(`/files/${fileId}`)).status, 404);
  assert.equal((await other.post(`/files/${fileId}/complete`, {})).status, 404);
  assert.equal((await other.post(`/files/${fileId}/upload/parts`, { partNumbers: [1] })).status, 404);
  assert.equal((await other.post('/shares/links', { fileId, canDownload: true })).status, 404);
  assert.equal((await other.post('/shares/grants', { fileId, email: other.email, canDownload: true })).status, 404);
  assert.equal((await other.get(`/shares?fileId=${fileId}`)).status, 404);
  assert.equal((await other.get(`/folders/${folder.id}/contents`)).status, 404);
  assert.equal((await other.patch(`/folders/${folder.id}`, { name: 'x' })).status, 404);
  assert.equal((await other.delete(`/folders/${folder.id}`)).status, 404);
  // Déposer un fichier dans le dossier d'un autre, ou y déplacer le sien
  assert.equal((await other.post('/files/uploads', { name: 'a.txt', size: 3, folderId: folder.id })).status, 404);
  assert.equal((await other.post('/folders', { name: 'infiltré', parentId: folder.id })).status, 404);
  // Le propriétaire, lui, y a toujours accès
  assert.equal((await owner.get(`/files/${fileId}`)).status, 200);
  // Rien n'a été modifié
  assert.equal((await owner.get(`/files/${fileId}`)).data.file.name, 'carte.geojson');
});

test('un utilisateur ne peut pas déplacer son fichier dans le dossier d\'un autre', async () => {
  const { owner, other } = await setup();
  const folder = (await owner.post('/folders', { name: 'D' })).data.folder;
  const mine = await other.upload({ name: 'a.txt', data: 'a' });
  assert.equal((await other.patch(`/files/${mine.fileId}`, { folderId: folder.id })).status, 404);
});

test('lien de partage : accès anonyme en lecture seule (sans téléchargement), jeton uniquement dans un en-tête', async () => {
  const { owner, fileId } = await setup();
  const link = await owner.post('/shares/links', { fileId, canDownload: false });
  assert.equal(link.status, 201);
  const { token } = link.data;
  assert.match(link.data.url, /\/share\.html#/, 'le jeton est dans le fragment, jamais envoyé au serveur');
  const row = await t.ctx.db.shareLink.findFirst({ where: { fileId } });
  assert.notEqual(row.tokenHash, token, 'le jeton n\'est pas stocké en clair');
  assert.equal(row.tokenHash.length, 64);

  const anon = t.client();
  const root = await anon.get('/public/share', { share: token });
  assert.equal(root.status, 200);
  assert.equal(root.data.kind, 'file');
  assert.equal(root.data.file.name, 'carte.geojson');
  const leaked = JSON.stringify(root.data);
  for (const forbidden of ['ownerId', 'storageKey', 'sha256', 'folderId', 'Propriétaire', 'passwordHash', 'email']) assert.equal(leaked.includes(forbidden), false, forbidden);

  const prev = await anon.get(`/public/share/files/${fileId}/preview`, { share: token });
  assert.equal(prev.status, 200);
  assert.equal(prev.data.kind, 'geojson');
  const dl = await anon.get(`/public/share/files/${fileId}/download`, { share: token });
  assert.equal(dl.status, 403, 'téléchargement non autorisé par ce lien');
  // Sans jeton, avec un jeton inventé, ou avec le jeton dans l'URL : rien
  assert.equal((await anon.get('/public/share')).status, 404);
  assert.equal((await anon.get('/public/share', { share: 'x'.repeat(43) })).status, 404);
  assert.equal((await anon.get(`/public/share?token=${token}`)).status, 404);
});

test('lien avec téléchargement autorisé ; le lien ne couvre QUE son fichier', async () => {
  const { owner, fileId } = await setup();
  const second = await owner.upload({ name: 'secret.txt', data: 'confidentiel' });
  const { token } = (await owner.post('/shares/links', { fileId, canDownload: true })).data;
  const anon = t.client();
  const dl = await anon.get(`/public/share/files/${fileId}/download`, { share: token });
  assert.equal(dl.status, 200);
  assert.equal((await fetch(dl.data.url)).status, 200);
  assert.equal((await anon.get(`/public/share/files/${second.fileId}/download`, { share: token })).status, 404, 'autre fichier du même propriétaire : introuvable');
  assert.equal((await anon.get(`/public/share/files/${second.fileId}/preview`, { share: token })).status, 404);
});

test('révocation immédiate et expiration du lien', async () => {
  const { owner, fileId } = await setup();
  const link = (await owner.post('/shares/links', { fileId, canDownload: true })).data;
  const anon = t.client();
  assert.equal((await anon.get('/public/share', { share: link.token })).status, 200);

  assert.equal((await owner.delete(`/shares/links/${link.link.id}`)).status, 204);
  const revoked = await anon.get('/public/share', { share: link.token });
  assert.equal(revoked.status, 410);
  assert.equal(revoked.data.error.code, 'LINK_REVOKED');
  assert.equal((await anon.get(`/public/share/files/${fileId}/download`, { share: link.token })).status, 410);
  assert.equal((await owner.delete(`/shares/links/${link.link.id}`)).status, 404, 'déjà révoqué');

  const timed = (await owner.post('/shares/links', { fileId, canDownload: false, expiresInDays: 1 })).data;
  assert.equal((await anon.get('/public/share', { share: timed.token })).status, 200);
  await t.ctx.db.shareLink.update({ where: { id: timed.link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expired = await anon.get('/public/share', { share: timed.token });
  assert.equal(expired.status, 410);
  assert.equal(expired.data.error.code, 'LINK_EXPIRED');
});

test('un lien est supprimé avec sa ressource (corbeille) et un autre utilisateur ne peut pas révoquer un lien qui n\'est pas à lui', async () => {
  const { owner, other, fileId } = await setup();
  const link = (await owner.post('/shares/links', { fileId, canDownload: true })).data;
  assert.equal((await other.delete(`/shares/links/${link.link.id}`)).status, 404);
  const anon = t.client();
  assert.equal((await anon.get('/public/share', { share: link.token })).status, 200, 'toujours actif');
  await owner.delete(`/files/${fileId}`);
  assert.equal((await anon.get('/public/share', { share: link.token })).status, 404, 'fichier en corbeille : inaccessible');
  await owner.post(`/trash/files/${fileId}/restore`, {});
  assert.equal((await anon.get('/public/share', { share: link.token })).status, 200, 'restauré : le lien refonctionne');
});

test('lien sur dossier : navigation limitée au sous-arbre, pas aux dossiers frères ni parents', async () => {
  const owner = t.client();
  await owner.register();
  const parent = (await owner.post('/folders', { name: 'Parent' })).data.folder;
  const shared = (await owner.post('/folders', { name: 'Partagé', parentId: parent.id })).data.folder;
  const sub = (await owner.post('/folders', { name: 'Sous', parentId: shared.id })).data.folder;
  const sibling = (await owner.post('/folders', { name: 'Frère', parentId: parent.id })).data.folder;
  const inShared = await owner.upload({ name: 'public.txt', data: 'ok', folderId: shared.id });
  const inSub = await owner.upload({ name: 'profond.txt', data: 'ok', folderId: sub.id });
  const inSibling = await owner.upload({ name: 'prive.txt', data: 'non', folderId: sibling.id });
  const { token } = (await owner.post('/shares/links', { folderId: shared.id, canDownload: true })).data;
  const anon = t.client();

  const root = await anon.get('/public/share', { share: token });
  assert.equal(root.data.kind, 'folder');
  assert.deepEqual(root.data.files.map((f) => f.name), ['public.txt']);
  assert.deepEqual(root.data.folders.map((f) => f.name), ['Sous']);
  assert.equal((await anon.get(`/public/share/folders/${sub.id}`, { share: token })).status, 200);
  assert.equal((await anon.get(`/public/share/folders/${parent.id}`, { share: token })).status, 404);
  assert.equal((await anon.get(`/public/share/folders/${sibling.id}`, { share: token })).status, 404);
  assert.equal((await anon.get(`/public/share/files/${inSub.fileId}/download`, { share: token })).status, 200);
  assert.equal((await anon.get(`/public/share/files/${inShared.fileId}/download`, { share: token })).status, 200);
  assert.equal((await anon.get(`/public/share/files/${inSibling.fileId}/download`, { share: token })).status, 404);
});

test('partage avec un compte : destinataire en lecture seule, puis avec téléchargement, puis retrait', async () => {
  const { owner, other, fileId } = await setup();
  const g = await owner.post('/shares/grants', { fileId, email: other.email, canDownload: false });
  assert.equal(g.status, 202);

  const view = await other.get(`/files/${fileId}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.access.level, 'grant');
  assert.equal(view.data.access.canDownload, false);
  assert.equal(JSON.stringify(view.data).includes('sha256'), false, 'vue restreinte pour un destinataire');
  assert.equal((await other.get(`/files/${fileId}/preview`)).status, 200);
  assert.equal((await other.get(`/files/${fileId}/download`)).status, 403, 'lecture seule : pas de téléchargement');
  // Pas de modification ni de suppression ni de repartage
  assert.equal((await other.patch(`/files/${fileId}`, { name: 'x.geojson' })).status, 404);
  assert.equal((await other.delete(`/files/${fileId}`)).status, 404);
  assert.equal((await other.post('/shares/links', { fileId, canDownload: true })).status, 404);

  const withMe = await other.get('/shares/with-me');
  assert.equal(withMe.data.items.length, 1);
  assert.equal(withMe.data.items[0].file.name, 'carte.geojson');
  assert.equal(withMe.data.items[0].ownerName, 'Propriétaire');
  assert.equal(JSON.stringify(withMe.data).includes('storageKey'), false);

  await owner.post('/shares/grants', { fileId, email: other.email, canDownload: true });
  assert.equal((await other.get(`/files/${fileId}/download`)).status, 200);

  const list = await owner.get(`/shares?fileId=${fileId}`);
  assert.equal(list.data.grants.length, 1);
  assert.equal((await owner.delete(`/shares/grants/${list.data.grants[0].id}`)).status, 204);
  assert.equal((await other.get(`/files/${fileId}`)).status, 404, 'accès retiré immédiatement');
  assert.equal((await other.get(`/files/${fileId}/download`)).status, 404);
});

test('partage de dossier avec un compte : fichiers du dossier accessibles, fil d\'Ariane borné, parents invisibles', async () => {
  const owner = t.client();
  await owner.register();
  const other = t.client();
  await other.register();
  const top = (await owner.post('/folders', { name: 'Haut-secret' })).data.folder;
  const shared = (await owner.post('/folders', { name: 'Dossier partagé', parentId: top.id })).data.folder;
  const f = await owner.upload({ name: 'a.txt', data: 'a', folderId: shared.id });
  const hidden = await owner.upload({ name: 'cache.txt', data: 'c', folderId: top.id });
  await owner.post('/shares/grants', { folderId: shared.id, email: other.email, canDownload: true });

  const contents = await other.get(`/folders/${shared.id}/contents`);
  assert.equal(contents.status, 200);
  assert.deepEqual(contents.data.breadcrumb.map((b) => b.name), ['Dossier partagé'], 'le dossier parent n\'est pas révélé');
  assert.deepEqual(contents.data.files.map((x) => x.name), ['a.txt']);
  assert.equal((await other.get(`/files/${f.fileId}/download`)).status, 200);
  assert.equal((await other.get(`/folders/${top.id}/contents`)).status, 404);
  assert.equal((await other.get(`/files/${hidden.fileId}`)).status, 404);
});

test('partage : anti-énumération des comptes, pas de partage avec soi-même', async () => {
  const { owner, fileId } = await setup();
  const known = await owner.post('/shares/grants', { fileId, email: uniqueEmail('existe-pas'), canDownload: false });
  assert.equal(known.status, 202);
  assert.deepEqual(known.data, { accepted: true });
  const self = await owner.post('/shares/grants', { fileId, email: owner.email, canDownload: false });
  assert.equal(self.status, 400);
  assert.equal((await owner.post('/shares/links', { canDownload: true })).status, 400, 'ni fichier ni dossier');
  assert.equal((await owner.post('/shares/links', { fileId, folderId: fileId, canDownload: true })).status, 400, 'les deux à la fois');
});

test('compte désactivé : ses liens cessent de fonctionner et sa session est révoquée', async () => {
  const admin = t.client();
  const adminUser = await admin.register();
  await t.ctx.db.user.update({ where: { id: adminUser.id }, data: { role: 'ADMIN' } });
  const owner = t.client();
  const ownerUser = await owner.register();
  const f = await owner.upload({ name: 'a.txt', data: 'a' });
  const { token } = (await owner.post('/shares/links', { fileId: f.fileId, canDownload: true })).data;
  const anon = t.client();
  assert.equal((await anon.get('/public/share', { share: token })).status, 200);
  const r = await admin.patch(`/admin/users/${ownerUser.id}`, { disabled: true });
  assert.equal(r.status, 200);
  assert.equal((await anon.get('/public/share', { share: token })).status, 404);
  assert.equal((await owner.get('/auth/me')).status, 401, 'session révoquée');
  assert.equal((await t.client().login(owner.email)).status, 401, 'connexion refusée');
});

test('comptes : PASSWORD correct requis pour changer le mot de passe ; les autres sessions sont révoquées', async () => {
  const c1 = t.client();
  const email = uniqueEmail();
  await c1.register({ email });
  const c2 = t.client();
  await c2.login(email);
  assert.equal((await c2.get('/auth/me')).status, 200);
  const bad = await c1.post('/auth/change-password', { currentPassword: 'incorrect-incorrect', newPassword: 'Nouveau-mot-de-passe-77' });
  assert.equal(bad.status, 401);
  const ok = await c1.post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Nouveau-mot-de-passe-77' });
  assert.equal(ok.status, 204);
  assert.equal((await c2.get('/auth/me')).status, 401, 'l\'autre session est révoquée');
  assert.equal((await c1.get('/auth/me')).status, 200);
  assert.equal((await t.client().login(email, PASSWORD)).status, 401);
  assert.equal((await t.client().login(email, 'Nouveau-mot-de-passe-77')).status, 200);
});
