import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t;
before(async () => {
  t = await startTestApp();
});
after(async () => t.close());

const mk = async (c, name, parentId = null) => (await c.post('/folders', { name, parentId })).data.folder;

test('créer, lister, renommer et déplacer des dossiers', async () => {
  const c = t.client();
  await c.register();
  const a = await mk(c, 'Projets');
  const b = await mk(c, 'Cartes', a.id);
  await c.upload({ name: 'zone.geojson', data: '{"type":"FeatureCollection","features":[]}', folderId: b.id });

  const root = await c.get('/folders/root/contents');
  assert.deepEqual(root.data.folders.map((f) => f.name), ['Projets']);
  const inB = await c.get(`/folders/${b.id}/contents`);
  assert.deepEqual(inB.data.files.map((f) => f.name), ['zone.geojson']);
  assert.deepEqual(inB.data.breadcrumb.map((f) => f.name), ['Projets', 'Cartes']);

  const ren = await c.patch(`/folders/${b.id}`, { name: 'Cartes 2026' });
  assert.equal(ren.data.folder.name, 'Cartes 2026');
  const moved = await c.patch(`/folders/${b.id}`, { parentId: null });
  assert.equal(moved.data.folder.parentId, null);
});

test('un dossier ne peut pas être déplacé dans lui-même ni dans un de ses descendants', async () => {
  const c = t.client();
  await c.register();
  const a = await mk(c, 'A');
  const b = await mk(c, 'B', a.id);
  const cc = await mk(c, 'C', b.id);
  for (const target of [a.id, b.id, cc.id]) {
    const r = await c.patch(`/folders/${a.id}`, { parentId: target });
    assert.equal(r.status, 422, `déplacement de A vers ${target}`);
    assert.equal(r.data.error.code, 'FOLDER_CYCLE');
  }
});

test('profondeur maximale appliquée', async () => {
  const fresh = t.client();
  await fresh.register();
  let p = null;
  for (let i = 0; i < 20; i++) {
    const r = await fresh.post('/folders', { name: `d${i}`, parentId: p });
    assert.equal(r.status, 201, `niveau ${i + 1}`);
    p = r.data.folder.id;
  }
  const tooDeep = await fresh.post('/folders', { name: 'trop', parentId: p });
  assert.equal(tooDeep.status, 422);
  assert.equal(tooDeep.data.error.code, 'MAX_DEPTH');
});

test('corbeille : le dossier part avec son contenu, restauration en bloc, suppression définitive libère le quota', async () => {
  const c = t.client();
  await c.register();
  const a = await mk(c, 'Archive');
  const sub = await mk(c, 'Sous', a.id);
  const f1 = await c.upload({ name: 'un.txt', data: 'aaaa', folderId: a.id });
  const f2 = await c.upload({ name: 'deux.txt', data: 'bbbbbb', folderId: sub.id });
  assert.equal((await c.get('/auth/me')).data.user.usedBytes, 10);

  assert.equal((await c.delete(`/folders/${a.id}`)).status, 204);
  assert.equal((await c.get('/folders/root/contents')).data.folders.length, 0);
  assert.equal((await c.get(`/files/${f1.fileId}`)).status, 404, 'fichier dans la corbeille : introuvable');
  const trash = await c.get('/trash');
  assert.equal(trash.data.folders.length, 1, 'seule la racine de la suppression est listée');
  assert.equal(trash.data.files.length, 0);

  const restored = await c.post(`/trash/folders/${a.id}/restore`, {});
  assert.equal(restored.status, 200);
  assert.equal((await c.get(`/files/${f1.fileId}`)).status, 200);
  assert.equal((await c.get(`/files/${f2.fileId}`)).status, 200);
  assert.equal((await c.get(`/folders/${sub.id}/contents`)).status, 200);

  await c.delete(`/folders/${a.id}`);
  assert.equal((await c.delete(`/trash/folders/${a.id}`)).status, 204);
  assert.equal((await c.get('/auth/me')).data.user.usedBytes, 0);
  assert.equal((await c.get('/trash')).data.folders.length, 0);
  assert.equal(await t.ctx.db.fileAsset.count({ where: { id: { in: [f1.fileId, f2.fileId] } } }), 0);
});

test('restauration d\'un fichier dont le dossier est dans la corbeille : retour à la racine', async () => {
  const c = t.client();
  await c.register();
  const a = await mk(c, 'Temp');
  const f = await c.upload({ name: 'x.txt', data: 'x', folderId: a.id });
  await c.delete(`/files/${f.fileId}`);
  await c.delete(`/folders/${a.id}`);
  const r = await c.post(`/trash/files/${f.fileId}/restore`, {});
  assert.equal(r.status, 200);
  assert.equal(r.data.file.folderId, null);
});

test('vider la corbeille exige une confirmation explicite', async () => {
  const c = t.client();
  await c.register();
  const f = await c.upload({ name: 'x.txt', data: 'xx' });
  await c.delete(`/files/${f.fileId}`);
  assert.equal((await c.post('/trash/empty', {})).status, 400);
  assert.equal((await c.post('/trash/empty', { confirm: 'oui' })).status, 400);
  const r = await c.post('/trash/empty', { confirm: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.purgedFiles, 1);
  assert.equal((await c.get('/auth/me')).data.user.usedBytes, 0);
});

test('nom de dossier invalide refusé', async () => {
  const c = t.client();
  await c.register();
  assert.equal((await c.post('/folders', { name: '..' })).status, 422);
  assert.equal((await c.post('/folders', { name: '' })).status, 400);
  assert.equal((await c.post('/folders', { name: 'x'.repeat(300) })).status, 400);
  assert.equal((await c.post('/folders', { name: 'ok', extra: 1 })).status, 400, 'champ inconnu refusé');
});
