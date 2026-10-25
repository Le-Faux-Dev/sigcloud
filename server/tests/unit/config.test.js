import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config/env.js';
import { createR2Storage, attachmentDisposition } from '../../src/storage/r2.js';

const base = { APP_SECRET: 'x'.repeat(40), DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
const prod = {
  ...base,
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://sig.example.test',
  STORAGE_DRIVER: 'r2',
  R2_ACCOUNT_ID: 'acc',
  R2_ACCESS_KEY_ID: 'AKIATESTTESTTEST',
  R2_SECRET_ACCESS_KEY: 'secret-secret-secret-secret',
  R2_BUCKET: 'bucket',
  CRON_SECRET: 'c'.repeat(40),
  RATE_LIMIT_STORE: 'postgres',
};

test('configuration valide : valeurs par défaut sûres', () => {
  const c = loadConfig(base);
  assert.equal(c.isProd, false);
  assert.equal(c.limits.maxFileBytes, 50 * 1024 * 1024);
  assert.equal(c.mailDriver, 'none');
  assert.ok(Object.isFrozen(c));
});

test('refus de démarrer : secret trop court, base absente', () => {
  assert.throws(() => loadConfig({ ...base, APP_SECRET: 'court' }), /APP_SECRET/);
  assert.throws(() => loadConfig({ APP_SECRET: base.APP_SECRET }), /DATABASE_URL/);
});

test('production : configurations dangereuses refusées', () => {
  assert.doesNotThrow(() => loadConfig(prod));
  assert.throws(() => loadConfig({ ...prod, STORAGE_DRIVER: 'local' }), /STORAGE_DRIVER/);
  assert.throws(() => loadConfig({ ...prod, APP_ORIGIN: 'http://sig.example.test' }), /https/);
  assert.throws(() => loadConfig({ ...prod, MAIL_DRIVER: 'dev-outbox' }), /dev-outbox/);
  assert.throws(() => loadConfig({ ...prod, CRON_SECRET: undefined }), /CRON_SECRET/);
  assert.throws(() => loadConfig({ ...prod, APP_SECRET: 'CHANGE_ME_' + 'x'.repeat(30) }), /d'exemple/);
  assert.throws(() => loadConfig({ ...prod, RATE_LIMIT_STORE: 'memory' }), /memory/);
  assert.throws(() => loadConfig({ ...prod, R2_BUCKET: undefined }), /R2_BUCKET/);
  assert.throws(() => loadConfig({ ...prod, RATE_LIMIT_STORE: 'upstash' }), /UPSTASH/);
  assert.equal(loadConfig(prod).cookieSecure, true);
});

test('la taille de partie minimale S3/R2 (5 Mo) est imposée', () => {
  assert.throws(() => loadConfig({ ...base, PART_SIZE_BYTES: '1048576' }), /5 Mo/);
});

test('les messages d\'erreur de configuration ne contiennent jamais la valeur du secret', () => {
  try {
    loadConfig({ ...base, APP_SECRET: 'court-secret' });
    assert.fail();
  } catch (e) {
    assert.doesNotMatch(e.message, /court-secret/);
  }
});

test('R2 : URLs signées générées hors ligne — expiration, taille signée, aucune clé secrète dans l\'URL', async () => {
  const cfg = loadConfig({ ...prod, UPLOAD_URL_TTL_SECONDS: '900' });
  const r2 = createR2Storage(cfg);
  const put = await r2.presignPutObject({ key: 'ab/0123456789abcdef', size: 1234, ttl: 900 });
  const u = new URL(put.url);
  assert.equal(u.protocol, 'https:');
  assert.match(u.hostname, /acc\.r2\.cloudflarestorage\.com$/);
  assert.equal(u.searchParams.get('X-Amz-Expires'), '900');
  assert.match(u.searchParams.get('X-Amz-SignedHeaders'), /content-length/);
  assert.equal(put.url.includes(cfg.storage.r2.secretAccessKey), false);
  assert.equal(put.method, 'PUT');

  const dl = await r2.presignDownload({ key: 'ab/0123456789abcdef', filename: 'carte "é".geojson', ttl: 300 });
  const d = new URL(dl);
  assert.equal(d.searchParams.get('X-Amz-Expires'), '300');
  assert.match(d.searchParams.get('response-content-disposition'), /^attachment;/);
  assert.equal(d.searchParams.get('response-content-type'), 'application/octet-stream', 'jamais de type fourni par l\'utilisateur');

  const part = await r2.presignUploadPart({ key: 'ab/0123456789abcdef', uploadId: 'abc', partNumber: 3, size: 5242880, ttl: 900 });
  assert.equal(new URL(part.url).searchParams.get('partNumber'), '3');
});

test('Content-Disposition : nom hostile neutralisé (guillemets, point-virgule, retours à la ligne, non-ASCII)', () => {
  const h = attachmentDisposition('a"b;c\r\nSet-Cookie: x=1é.txt');
  assert.doesNotMatch(h, /[\r\n]/);
  assert.match(h, /^attachment; filename="a_b_c__Set-Cookie: x=1_\.txt"; filename\*=UTF-8''/);
  assert.match(attachmentDisposition('x.png', true), /^inline;/);
});
