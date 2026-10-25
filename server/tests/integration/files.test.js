import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { startTestApp, geojsonSample, kmlSample, PNG_1PX } from '../helpers.js';

let t;
before(async () => {
  t = await startTestApp({ PART_SIZE_BYTES: String(5 * 1024 * 1024) });
});
after(async () => t.close());

const sha = (b) => createHash('sha256').update(b).digest('hex');

test('envoi simple puis téléchargement identique à l\'original (hash)', async () => {
  const c = t.client();
  await c.register();
  const data = Buffer.concat([PNG_1PX, randomBytes(2000)]);
  const { complete } = await c.upload({ name: 'photo.png', data });
  assert.equal(complete.status, 200);
  assert.equal(complete.data.file.uploadStatus, 'READY');
  assert.equal(complete.data.file.sha256, sha(data));
  assert.equal(complete.data.file.securityStatus, 'FORMAT_VERIFIED');
  assert.equal(complete.data.file.storageKey, undefined, 'la clé de stockage ne doit jamais sortir');

  const dl = await c.get(`/files/${complete.data.file.id}/download`);
  assert.equal(dl.status, 200);
  const res = await fetch(dl.data.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
  assert.equal(sha(Buffer.from(await res.arrayBuffer())), sha(data));
});

test('envoi en plusieurs parties (> 5 Mo) et reprise après interruption', async () => {
  const c = t.client();
  await c.register();
  const data = Buffer.concat([PNG_1PX, randomBytes(11 * 1024 * 1024)]); // 3 parties de 5 Mo
  const init = await c.post('/files/uploads', { name: 'gros.png', size: data.length });
  assert.equal(init.status, 201);
  assert.equal(init.data.upload.mode, 'multipart');
  assert.equal(init.data.upload.partCount, 3);
  const id = init.data.file.id;

  // On n'envoie que la partie 1 puis on « coupe le réseau ».
  const first = await c.post(`/files/${id}/upload/parts`, { partNumbers: [1] });
  const part = first.data.parts[0];
  const ok = await fetch(part.url, { method: 'PUT', body: data.subarray(0, part.size) });
  assert.ok(ok.ok);

  // Complete trop tôt : refusé, aucune donnée corrompue.
  const early = await c.post(`/files/${id}/complete`, {});
  assert.equal(early.status, 409);
  assert.equal(early.data.error.code, 'UPLOAD_INCOMPLETE');

  // Reprise : on lit l'état, puis on ne renvoie QUE les parties manquantes.
  const state = await c.get(`/files/${id}/upload`);
  assert.deepEqual(state.data.parts.map((p) => p.partNumber), [1]);
  const missing = await c.post(`/files/${id}/upload/parts`, { partNumbers: [2, 3] });
  for (const p of missing.data.parts) {
    const start = (p.partNumber - 1) * 5 * 1024 * 1024;
    const r = await fetch(p.url, { method: 'PUT', body: data.subarray(start, start + p.size) });
    assert.ok(r.ok);
  }
  const done = await c.post(`/files/${id}/complete`, {});
  assert.equal(done.status, 200);
  assert.equal(done.data.file.sha256, sha(data));
  const again = await c.post(`/files/${id}/complete`, {});
  assert.equal(again.status, 200, 'complete est idempotent');
});

test('quota : refusé avant l\'envoi, pas de dépassement, quota libéré à la suppression définitive', async () => {
  const c = t.client();
  const user = await c.register();
  const admin = t.ctx.db;
  await admin.user.update({ where: { id: user.id }, data: { quotaBytes: 5000n } });

  const a = await c.upload({ name: 'a.txt', data: Buffer.alloc(3000, 97) });
  assert.equal(a.complete.status, 200);
  const tooMuch = await c.post('/files/uploads', { name: 'b.txt', size: 3000 });
  assert.equal(tooMuch.status, 413);
  assert.equal(tooMuch.data.error.code, 'QUOTA_EXCEEDED');
  assert.equal((await c.get('/auth/me')).data.user.usedBytes, 3000);

  assert.equal((await c.delete(`/files/${a.fileId}`)).status, 204); // corbeille : l'espace reste occupé
  assert.equal((await c.get('/auth/me')).data.user.usedBytes, 3000);
  assert.equal((await c.delete(`/trash/files/${a.fileId}`)).status, 204); // suppression définitive
  assert.equal((await c.get('/auth/me')).data.user.usedBytes, 0);
});

test('quota : deux envois simultanés ne peuvent pas le dépasser ensemble', async () => {
  const c = t.client();
  const user = await c.register();
  await t.ctx.db.user.update({ where: { id: user.id }, data: { quotaBytes: 5000n } });
  const results = await Promise.all([1, 2, 3, 4].map((i) => c.post('/files/uploads', { name: `p${i}.txt`, size: 2000 })));
  const accepted = results.filter((r) => r.status === 201).length;
  assert.equal(accepted, 2, `2 envois de 2000 octets tiennent dans 5000 ; reçu ${accepted}`);
});

test('refus : extension non autorisée, sans extension, 7z, fichier trop gros', async () => {
  const c = t.client();
  await c.register();
  for (const [name, code] of [['virus.exe', 'FORMAT_NOT_ALLOWED'], ['script.php', 'FORMAT_NOT_ALLOWED'], ['sansext', 'NO_EXTENSION'], ['archive.7z', 'FORMAT_DEFERRED']]) {
    const r = await c.post('/files/uploads', { name, size: 100 });
    assert.equal(r.status, 422, name);
    assert.equal(r.data.error.code, code, name);
  }
  const big = await c.post('/files/uploads', { name: 'enorme.zip', size: t.config.limits.maxFileBytes + 1 });
  assert.equal(big.status, 413);
  assert.equal(big.data.error.code, 'FILE_TOO_LARGE');
  const zero = await c.post('/files/uploads', { name: 'vide.txt', size: 0 });
  assert.equal(zero.status, 400);
});

test('extension trompeuse : un exécutable renommé .png est refusé et son quota libéré', async () => {
  const c = t.client();
  await c.register();
  const fake = Buffer.concat([Buffer.from('MZ'), randomBytes(500)]);
  const r = await c.upload({ name: 'innocent.png', data: fake });
  assert.equal(r.complete.status, 422);
  assert.equal(r.complete.data.error.code, 'CONTENT_MISMATCH');
  assert.equal((await c.get('/auth/me')).data.user.usedBytes, 0);
  const list = await c.get('/files?folderId=all');
  assert.equal(list.data.total, 0);
  assert.equal(await t.ctx.storage.head('inexistant/x'.replace('/', '0')), null);
});

test('taille réelle différente de la taille annoncée : refusé', async () => {
  const c = t.client();
  await c.register();
  const init = await c.post('/files/uploads', { name: 'menteur.txt', size: 1000 });
  // URL signée pour 1000 octets : un envoi de taille différente est rejeté par le stockage lui-même.
  const short = await fetch(init.data.upload.url, { method: 'PUT', body: Buffer.alloc(900, 97) });
  assert.equal(short.status, 400);
  const complete = await c.post(`/files/${init.data.file.id}/complete`, {});
  assert.equal(complete.status, 409);
  assert.equal(complete.data.error.code, 'UPLOAD_MISSING');
  // On peut annuler : le quota réservé est rendu.
  assert.equal((await c.delete(`/files/${init.data.file.id}/upload`)).status, 204);
  assert.equal((await c.get('/auth/me')).data.user.usedBytes, 0);
});

test('aperçu GeoJSON : valide, avec métadonnées réellement calculées', async () => {
  const c = t.client();
  await c.register();
  const { complete } = await c.upload({ name: 'quartiers.geojson', data: geojsonSample() });
  assert.equal(complete.status, 200);
  const f = complete.data.file;
  assert.equal(f.previewStatus, 'PREVIEWABLE');
  assert.equal(f.geoMeta.featureCount, 2);
  assert.deepEqual(f.geoMeta.geometryTypes, ['LineString', 'Point']);
  assert.deepEqual(f.geoMeta.bbox, [-4.03, 5.31, -4, 5.34]);
  const prev = await c.get(`/files/${f.id}/preview`);
  assert.equal(prev.status, 200);
  assert.equal(prev.data.kind, 'geojson');
  assert.equal(prev.data.data.features.length, 2);
});

test('aperçu KML valide ; KML avec DOCTYPE/ENTITY refusé', async () => {
  const c = t.client();
  await c.register();
  const ok = await c.upload({ name: 'lieux.kml', data: kmlSample });
  assert.equal(ok.complete.status, 200);
  assert.equal(ok.complete.data.file.previewStatus, 'PREVIEWABLE');
  assert.equal(ok.complete.data.file.geoMeta.featureCount, 1);

  const xxe = `<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY a "boom">]><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>&a;</name><Point><coordinates>1,1</coordinates></Point></Placemark></Document></kml>`;
  const bad = await c.upload({ name: 'xxe.kml', data: xxe });
  assert.equal(bad.complete.status, 422);
  assert.equal(bad.complete.data.error.code, 'XML_DTD_FORBIDDEN');
});

test('GPX : aperçu des traces ; DOCTYPE refusé ; Shapefile : .shp réel accepté, faux .shp refusé', async () => {
  const c = t.client();
  await c.register();
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Balade</name><trkseg><trkpt lat="5.35" lon="-4.00"></trkpt><trkpt lat="5.36" lon="-4.01"></trkpt></trkseg></trk></gpx>`;
  const ok = await c.upload({ name: 'balade.gpx', data: gpx });
  assert.equal(ok.complete.status, 200);
  assert.equal(ok.complete.data.file.previewStatus, 'PREVIEWABLE');
  const evil = await c.upload({ name: 'x.gpx', data: gpx.replace('<gpx', '<!DOCTYPE gpx [<!ENTITY a "b">]><gpx') });
  assert.equal(evil.complete.status, 422);
  const shpHead = Buffer.alloc(100);
  shpHead.writeInt32BE(9994, 0);
  const shp = await c.upload({ name: 'villages.shp', data: shpHead });
  assert.equal(shp.complete.status, 200);
  assert.equal(shp.complete.data.file.previewStatus, 'NONE');
  const fake = await c.upload({ name: 'faux.shp', data: Buffer.from('ceci n est pas un shapefile') });
  assert.equal(fake.complete.status, 422);
});

test('GeoJSON invalide refusé ; .json quelconque accepté mais non prévisualisable ; hors WGS84 non prévisualisable', async () => {
  const c = t.client();
  await c.register();
  const broken = await c.upload({ name: 'casse.geojson', data: '{"type":"FeatureCollection","features":[' });
  assert.equal(broken.complete.status, 422);
  assert.equal(broken.complete.data.error.code, 'INVALID_JSON');

  const notGeo = await c.upload({ name: 'autre.geojson', data: '{"hello":"world"}' });
  assert.equal(notGeo.complete.status, 422);
  assert.equal(notGeo.complete.data.error.code, 'INVALID_GEOJSON');

  const plain = await c.upload({ name: 'config.json', data: '{"hello":"world"}' });
  assert.equal(plain.complete.status, 200);
  assert.equal(plain.complete.data.file.previewStatus, 'UNSUPPORTED');
  assert.equal(plain.complete.data.file.previewReason, 'NOT_GEOJSON');
  const noPrev = await c.get(`/files/${plain.fileId}/preview`);
  assert.equal(noPrev.status, 422);
  assert.equal(noPrev.data.error.code, 'NOT_PREVIEWABLE');

  const utm = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [500000, 600000] } }] });
  const projected = await c.upload({ name: 'utm.geojson', data: utm });
  assert.equal(projected.complete.status, 200);
  assert.equal(projected.complete.data.file.previewStatus, 'UNSUPPORTED');
  assert.equal(projected.complete.data.file.previewReason, 'COORDINATES_NOT_WGS84');
  assert.equal(projected.complete.data.file.geoMeta, null, 'aucune métadonnée inventée');
});

test('XSS : les attributs et noms hostiles restent des données ; __proto__ ignoré ; objets imbriqués supprimés', async () => {
  const c = t.client();
  await c.register();
  const evil = JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { nom: '<img src=x onerror=alert(1)>', __proto__: { polluted: true }, nested: { a: 1 }, ok: 3 } }],
  });
  const r = await c.upload({ name: '<script>alert(1)</script>.geojson', data: evil });
  assert.equal(r.complete.status, 200);
  // Le « / » devient « _ » (anti-traversée de chemin) ; le reste est stocké comme une simple donnée,
  // jamais interprétée : le client n'affiche les noms qu'avec textContent.
  assert.equal(r.complete.data.file.name, '<script>alert(1)<_script>.geojson');
  const prev = await c.get(`/files/${r.fileId}/preview`);
  const props = prev.data.data.features[0].properties;
  assert.equal(props.nom, '<img src=x onerror=alert(1)>');
  assert.equal(props.ok, 3);
  assert.equal('nested' in props, false);
  assert.equal(Object.prototype.polluted, undefined);
});

test('ZIP : stocké sans extraction, marqué « non analysé en profondeur » ; ZIP corrompu refusé', async () => {
  const c = t.client();
  await c.register();
  const fakeZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(300)]);
  const z = await c.upload({ name: 'donnees.zip', data: fakeZip });
  assert.equal(z.complete.status, 200);
  assert.equal(z.complete.data.file.securityStatus, 'NOT_DEEP_SCANNED');
  assert.equal(z.complete.data.file.previewStatus, 'NONE');
  const bad = await c.upload({ name: 'faux.zip', data: Buffer.from('ceci n\'est pas un zip') });
  assert.equal(bad.complete.status, 422);
  // GeoTIFF : signature vérifiée, stocké seulement
  const tif = await c.upload({ name: 'raster.tif', data: Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), randomBytes(100)]) });
  assert.equal(tif.complete.status, 200);
  assert.equal(tif.complete.data.file.previewStatus, 'NONE');
});

test('aperçu trop volumineux : stocké et téléchargeable mais non prévisualisable', async () => {
  const small = await startTestApp({ PREVIEW_MAX_BYTES: '1000' });
  try {
    const c = small.client();
    await c.register();
    const r = await c.upload({ name: 'grand.geojson', data: geojsonSample({ pad: 'x'.repeat(2000) }) });
    assert.equal(r.complete.status, 200);
    assert.equal(r.complete.data.file.previewStatus, 'UNSUPPORTED');
    assert.equal(r.complete.data.file.previewReason, 'TOO_LARGE');
    assert.equal((await c.get(`/files/${r.fileId}/download`)).status, 200);
  } finally {
    await small.close();
  }
});

test('noms : séparateurs de chemin et marques bidirectionnelles neutralisés', async () => {
  const c = t.client();
  await c.register();
  const r = await c.upload({ name: '../../etc/passwd.txt', data: 'x' });
  assert.equal(r.complete.status, 200);
  assert.equal(r.complete.data.file.name, '.._.._etc_passwd.txt');
  const rlo = await c.upload({ name: 'fdp‮gnp.txt', data: 'x' });
  assert.equal(rlo.complete.data.file.name, 'fdpgnp.txt');
  // L'extension ne peut pas être changée par renommage.
  const ren = await c.patch(`/files/${r.fileId}`, { name: 'maintenant.exe' });
  assert.equal(ren.status, 422);
  const ok = await c.patch(`/files/${r.fileId}`, { name: 'renomme.txt', tags: ['A', 'a', 'b'], description: 'Test' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.file.tags, ['a', 'b']);
});

test('recherche, tri, filtres et pagination', async () => {
  const c = t.client();
  await c.register();
  await c.upload({ name: 'alpha.geojson', data: geojsonSample() });
  await c.upload({ name: 'beta.kml', data: kmlSample });
  await c.upload({ name: 'gamma.png', data: PNG_1PX });
  await c.upload({ name: 'notes.txt', data: 'bonjour' });
  const all = await c.get('/files?folderId=all&sort=name&order=asc');
  assert.deepEqual(all.data.items.map((f) => f.name), ['alpha.geojson', 'beta.kml', 'gamma.png', 'notes.txt']);
  assert.equal((await c.get('/files?folderId=all&q=ALP')).data.total, 1);
  assert.equal((await c.get('/files?folderId=all&category=vector')).data.total, 2);
  assert.equal((await c.get('/files?folderId=all&category=vector&ext=png')).data.total, 0);
  assert.equal((await c.get('/files?folderId=all&ext=kml')).data.total, 1);
  assert.equal((await c.get('/files?folderId=all&preview=yes')).data.total, 4);
  const page = await c.get('/files?folderId=all&sort=name&order=asc&limit=2&offset=2');
  assert.deepEqual(page.data.items.map((f) => f.name), ['gamma.png', 'notes.txt']);
  assert.equal((await c.get("/files?folderId=all&q=%27%20OR%201%3D1%20--")).data.total, 0);
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await c.get(`/files?folderId=all&from=${encodeURIComponent(future)}`)).data.total, 0);
  assert.equal((await c.get('/files?folderId=all&limit=1000')).status, 400);
});

test('utilisation du stockage : sommes réelles par catégorie, corbeille comptée à part', async () => {
  const c = t.client();
  await c.register();
  await c.upload({ name: 'a.geojson', data: geojsonSample() });
  await c.upload({ name: 'b.png', data: PNG_1PX });
  const doc = await c.upload({ name: 'c.txt', data: 'bonjour' });
  await c.delete(`/files/${doc.fileId}`);
  const u = await c.get('/files/usage');
  assert.equal(u.status, 200);
  assert.equal(u.data.byCategory.vector.count, 1);
  assert.equal(u.data.byCategory.image.bytes, PNG_1PX.length);
  assert.equal(u.data.byCategory.document, undefined, 'la corbeille n\'est pas dans les catégories');
  assert.equal(u.data.trashBytes, 7);
  assert.equal(u.data.usedBytes, Buffer.byteLength(geojsonSample()) + PNG_1PX.length + 7);
});
