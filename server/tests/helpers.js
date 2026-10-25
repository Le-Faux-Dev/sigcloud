import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';

let seq = 0;
let ipSeq = 1;
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now().toString(36)}.${seq++}.${randomBytes(3).toString('hex')}@example.test`;
export const PASSWORD = 'Un-mot-de-passe-solide-42'; // secret-scan: ignore (mot de passe fictif de test)

/** Démarre l'application sur un port libre, avec un stockage local temporaire et la vraie base de test. */
export async function startTestApp(envOverrides = {}) {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const storageDir = await mkdtemp(join(tmpdir(), 'sigcloud-store-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ORIGIN: `http://127.0.0.1:${port}`,
    APP_SECRET: process.env.APP_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: storageDir,
    MAIL_DRIVER: 'dev-outbox',
    CRON_SECRET: 'cron-secret-cron-secret-cron-secret-1234',
    // Chaque client de test a sa propre adresse IP (X-Forwarded-For) : les limites de débit s'appliquent par client.
    TRUST_PROXY: '1',
    ...envOverrides,
  });
  const { app, ctx } = createApp({ config });
  server.on('request', app);
  const baseUrl = config.appOrigin;

  const app_ = {
    baseUrl,
    ctx,
    config,
    client: (ip) => new Client(baseUrl, ip),
    async close() {
      await new Promise((r) => server.close(r));
      await ctx.db.$disconnect();
      await ctx.db.$closePool?.();
      await rm(storageDir, { recursive: true, force: true });
    },
  };
  return app_;
}

/** Client HTTP de test avec « cookie jar » et jeton CSRF, comme un navigateur. */
export class Client {
  constructor(baseUrl, ip) {
    this.baseUrl = baseUrl;
    this.ip = ip ?? `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`;
    this.cookies = new Map();
    this.csrf = null;
    this.user = null;
  }

  async raw(method, path, { json, body, headers = {}, csrf = true, cookies = true, share } = {}) {
    const h = { 'x-forwarded-for': this.ip, ...headers };
    if (cookies && this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (csrf && this.csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = this.csrf;
    if (share) h['x-share-token'] = share;
    let payload = body;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(json);
    }
    const res = await fetch(`${path.startsWith('http') ? path : this.baseUrl + path}`, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  async api(method, path, opts = {}) {
    const res = await this.raw(method, `/api/v1${path}`, opts);
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, headers: res.headers, data };
  }

  get = (path, opts) => this.api('GET', path, opts);
  post = (path, json, opts) => this.api('POST', path, { json, ...opts });
  patch = (path, json, opts) => this.api('PATCH', path, { json, ...opts });
  delete = (path, opts) => this.api('DELETE', path, opts);

  async register({ email = uniqueEmail(), password = PASSWORD, displayName = 'Testeur' } = {}) {
    const r = await this.post('/auth/register', { email, password, displayName });
    if (r.status !== 201) throw new Error(`register a échoué : ${r.status} ${JSON.stringify(r.data)}`);
    this.csrf = r.data.csrfToken;
    this.user = r.data.user;
    this.email = email;
    return r.data.user;
  }

  async login(email, password = PASSWORD) {
    const r = await this.post('/auth/login', { email, password });
    if (r.status === 200) {
      this.csrf = r.data.csrfToken;
      this.user = r.data.user;
    }
    return r;
  }

  /** Envoi complet d'un fichier : init → octets directs vers le stockage → complete. */
  async upload({ name, data, folderId = null, partSize }) {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const init = await this.post('/files/uploads', { name, size: buffer.length, folderId });
    if (init.status !== 201) return { init };
    const { file, upload } = init.data;
    if (upload.mode === 'single') {
      const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: buffer });
      if (!put.ok) throw new Error(`PUT a échoué : ${put.status}`);
    } else {
      const size = partSize ?? upload.partSize;
      const numbers = Array.from({ length: upload.partCount }, (_, i) => i + 1);
      const signed = await this.post(`/files/${file.id}/upload/parts`, { partNumbers: numbers });
      for (const p of signed.data.parts) {
        const start = (p.partNumber - 1) * size;
        const chunk = buffer.subarray(start, Math.min(start + size, buffer.length));
        const put = await fetch(p.url, { method: p.method, headers: p.headers, body: chunk });
        if (!put.ok) throw new Error(`PUT partie ${p.partNumber} a échoué : ${put.status}`);
      }
    }
    const complete = await this.post(`/files/${file.id}/complete`, {});
    return { init, complete, fileId: file.id };
  }
}

export const geojsonSample = (extra = {}) =>
  JSON.stringify({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { nom: 'Plateau', pop: 12 }, geometry: { type: 'Point', coordinates: [-4.0167, 5.3167] } },
      { type: 'Feature', properties: { nom: 'Route' }, geometry: { type: 'LineString', coordinates: [[-4.03, 5.31], [-4.0, 5.34]] } },
    ],
    ...extra,
  });

export const kmlSample = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Abidjan</name><Point><coordinates>-4.0083,5.3600,0</coordinates></Point></Placemark>
</Document></kml>`;

// Images minimales valides (signatures réelles)
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
