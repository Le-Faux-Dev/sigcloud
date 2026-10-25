import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat, open, rename } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomHex, hmacBase64Url, safeEqual } from '../lib/crypto.js';

// Pilote de stockage LOCAL : développement et tests uniquement (refusé en production par config/env.js).
// Il reproduit le comportement d'un stockage objet privé : clés aléatoires, envoi par URL signée,
// envoi en plusieurs parties, lecture par plage.

const KEY_RE = /^[a-z0-9]{2,}(\/[a-z0-9]{2,})*$/;

export function createLocalStorage(config) {
  const base = resolve(config.storage.localDir);
  const mpBase = join(base, '.multipart');

  function pathFor(key) {
    if (!KEY_RE.test(key)) throw new Error('clé de stockage invalide');
    const p = resolve(base, key);
    if (!p.startsWith(base + sep)) throw new Error('clé de stockage hors du dossier de stockage');
    return p;
  }
  function mpDir(uploadId) {
    if (!/^[a-f0-9]{32}$/.test(uploadId)) throw new Error('identifiant de transfert invalide');
    return join(mpBase, uploadId);
  }

  const sign = (payload) => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${hmacBase64Url(config.appSecret, `local-storage:${body}`)}`;
  };

  /** Vérifie un jeton d'URL signée locale. Retourne le contenu ou null. */
  function verifyToken(token, op) {
    if (typeof token !== 'string') return null;
    const [body, mac] = token.split('.');
    if (!body || !mac) return null;
    if (!safeEqual(mac, hmacBase64Url(config.appSecret, `local-storage:${body}`))) return null;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (payload.op !== op || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  }

  const url = (route, token) => `${config.appOrigin}/api/v1/_local-storage/${route}?token=${encodeURIComponent(token)}`;

  async function writeStream(target, stream, maxBytes) {
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.${randomHex(6)}.tmp`;
    let received = 0;
    const counter = async function* (src) {
      for await (const chunk of src) {
        received += chunk.length;
        if (received > maxBytes) throw Object.assign(new Error('taille dépassée'), { code: 'TOO_LARGE' });
        yield chunk;
      }
    };
    try {
      await pipeline(stream, counter, createWriteStream(tmp, { flags: 'wx' }));
      await rename(tmp, target);
      return received;
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  return {
    driver: 'local',
    verifyToken,

    async presignPutObject({ key, size, ttl }) {
      const token = sign({ op: 'put', key, size, exp: Date.now() + ttl * 1000 });
      return { url: url('upload', token), method: 'PUT', headers: {} };
    },

    async createMultipart() {
      const uploadId = randomHex(16);
      await mkdir(mpDir(uploadId), { recursive: true });
      return { uploadId };
    },

    async presignUploadPart({ key, uploadId, partNumber, size, ttl }) {
      const token = sign({ op: 'part', key, uploadId, partNumber, size, exp: Date.now() + ttl * 1000 });
      return { url: url('upload', token), method: 'PUT', headers: {} };
    },

    async listParts({ uploadId }) {
      let names;
      try {
        names = await readdir(mpDir(uploadId));
      } catch {
        return [];
      }
      const parts = [];
      for (const n of names) {
        if (!/^\d+$/.test(n)) continue;
        const s = await stat(join(mpDir(uploadId), n));
        parts.push({ partNumber: Number(n), size: s.size, etag: `${n}-${s.size}` });
      }
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },

    async completeMultipart({ key, uploadId }) {
      const parts = await this.listParts({ uploadId });
      if (!parts.length) throw new Error('aucune partie reçue');
      const target = pathFor(key);
      await mkdir(dirname(target), { recursive: true });
      const out = createWriteStream(target, { flags: 'w' });
      try {
        for (const p of parts) {
          await pipeline(createReadStream(join(mpDir(uploadId), String(p.partNumber))), out, { end: false });
        }
      } finally {
        await new Promise((r) => out.end(r));
      }
      await rm(mpDir(uploadId), { recursive: true, force: true });
    },

    async abortMultipart({ uploadId }) {
      await rm(mpDir(uploadId), { recursive: true, force: true });
    },

    async head(key) {
      try {
        const s = await stat(pathFor(key));
        return { size: s.size };
      } catch {
        return null;
      }
    },

    async readStream(key) {
      return createReadStream(pathFor(key));
    },

    async readRange(key, start, end) {
      const fh = await open(pathFor(key), 'r');
      try {
        const len = end - start + 1;
        const buf = Buffer.alloc(len);
        const { bytesRead } = await fh.read(buf, 0, len, start);
        return buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    },

    async delete(key) {
      await rm(pathFor(key), { force: true });
    },

    async presignDownload({ key, filename, ttl, inline = false, contentType }) {
      const token = sign({ op: 'get', key, filename, inline, contentType, exp: Date.now() + ttl * 1000 });
      return url('download', token);
    },

    // --- Réception des octets (routes réservées au stockage local) ---
    async receivePut(payload, stream) {
      if (payload.op === 'put') {
        const received = await writeStream(pathFor(payload.key), stream, payload.size);
        if (received !== payload.size) {
          await rm(pathFor(payload.key), { force: true });
          throw Object.assign(new Error('taille inattendue'), { code: 'SIZE_MISMATCH' });
        }
        return;
      }
      const target = join(mpDir(payload.uploadId), String(payload.partNumber));
      const received = await writeStream(target, stream, payload.size);
      if (received !== payload.size) {
        await rm(target, { force: true });
        throw Object.assign(new Error('taille inattendue'), { code: 'SIZE_MISMATCH' });
      }
    },

    async openForDownload(key) {
      return createReadStream(pathFor(key));
    },
  };
}
