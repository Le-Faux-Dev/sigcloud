// Gestionnaire d'envois. Les octets partent DIRECTEMENT du navigateur vers le stockage (URL signée) : jamais via l'API.
// Fichiers volumineux : envoi en plusieurs parties, 3 en parallèle, 3 essais par partie, reprise des parties manquantes.
import { api, errorMessage, getConfig } from './api.js';

const PART_PARALLEL = 3;
const FILE_PARALLEL = 2;
const PART_RETRIES = 3;
let seq = 0;

export class UploadManager extends EventTarget {
  constructor() {
    super();
    /** @type {Array<any>} */
    this.items = [];
  }

  emit(item) {
    this.dispatchEvent(new CustomEvent('change', { detail: item }));
  }

  /** Ajoute des fichiers après contrôles côté client (le serveur refait tous les contrôles). */
  async add(fileList, { folderId = null, quotaLeft = Infinity } = {}) {
    const config = await getConfig();
    const allowed = new Set(config.formats.map((f) => f.ext));
    let remaining = quotaLeft;
    const added = [];
    for (const file of Array.from(fileList)) {
      const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
      const item = { id: ++seq, file, name: file.name, size: file.size, folderId, status: 'queued', loaded: 0, error: null, fileId: null, controllers: new Set() };
      if (!allowed.has(ext)) {
        Object.assign(item, { status: 'error', error: ext ? `Le format .${ext} n'est pas autorisé.` : 'Le nom du fichier doit avoir une extension.' });
      } else if (file.size === 0) {
        Object.assign(item, { status: 'error', error: 'Le fichier est vide.' });
      } else if (file.size > config.limits.maxFileBytes) {
        Object.assign(item, { status: 'error', error: `Fichier trop volumineux (maximum ${Math.floor(config.limits.maxFileBytes / 1024 / 1024)} Mo).` });
      } else if (file.size > remaining) {
        Object.assign(item, { status: 'error', error: "Quota de stockage insuffisant pour ce fichier." });
      } else {
        remaining -= file.size;
      }
      this.items.push(item);
      added.push(item);
      this.emit(item);
    }
    this.pump();
    return added;
  }

  pump() {
    const running = this.items.filter((i) => i.status === 'uploading' || i.status === 'verifying').length;
    let slots = FILE_PARALLEL - running;
    for (const item of this.items) {
      if (slots <= 0) break;
      if (item.status === 'queued') {
        slots -= 1;
        this.run(item);
      }
    }
  }

  async retry(item) {
    if (item.status !== 'error' || !item.retryable) return;
    // Envoi simple : l'URL signée a pu expirer (15 min) → on repart d'une réservation neuve.
    // Envoi en plusieurs parties : on reprend, seules les parties manquantes sont renvoyées.
    if (item.upload?.mode === 'single' && item.fileId) {
      try {
        await api.delete(`/files/${item.fileId}/upload`);
      } catch {
        /* sera nettoyé par la tâche planifiée */
      }
      item.fileId = null;
      item.loaded = 0;
    }
    item.status = 'queued';
    item.error = null;
    this.emit(item);
    this.pump();
  }

  async cancel(item) {
    if (item.status === 'done' || item.status === 'canceled') return;
    const wasQueued = item.status === 'queued';
    item.status = 'canceled';
    item.canceled = true;
    for (const c of item.controllers) c.abort();
    this.emit(item);
    if (!wasQueued && item.fileId) {
      try {
        await api.delete(`/files/${item.fileId}/upload`);
      } catch {
        /* le serveur nettoiera l'envoi abandonné (tâche planifiée) */
      }
    }
    this.pump();
  }

  clearFinished() {
    this.items = this.items.filter((i) => !['done', 'error', 'canceled'].includes(i.status));
    this.dispatchEvent(new CustomEvent('change'));
  }

  get active() {
    return this.items.some((i) => ['queued', 'uploading', 'verifying'].includes(i.status));
  }

  async run(item) {
    item.status = 'uploading';
    item.error = null;
    this.emit(item);
    try {
      if (!item.fileId) {
        const init = await api.post('/files/uploads', { name: item.name, size: item.size, folderId: item.folderId });
        item.fileId = init.file.id;
        item.upload = init.upload;
        item.name = init.file.name;
      }
      if (item.canceled) return;
      if (item.upload.mode === 'single') await this.putSingle(item);
      else await this.putParts(item);
      if (item.canceled) return;
      item.status = 'verifying';
      this.emit(item);
      const done = await api.post(`/files/${item.fileId}/complete`, {});
      item.status = 'done';
      item.loaded = item.size;
      item.result = done.file;
      this.emit(item);
      this.dispatchEvent(new CustomEvent('done', { detail: item }));
    } catch (err) {
      if (item.canceled) return;
      item.status = 'error';
      // Une coupure réseau ou une partie manquante se reprend ; un refus du serveur (format, quota…) non.
      item.retryable = Boolean(item.fileId) && (err.code === 'NETWORK' || err.code === 'UPLOAD_INCOMPLETE' || err.code === 'UPLOAD_MISSING' || err.status >= 500 || err.name === 'PutError');
      item.error = err.name === 'PutError' ? err.message : errorMessage(err);
      // Refus de vérification : le serveur a déjà tout nettoyé (fichier et quota).
      if (err.status === 422) item.fileId = null;
      this.emit(item);
    } finally {
      this.pump();
    }
  }

  putSingle(item) {
    const { url, method, headers } = item.upload;
    return this.xhrPut(item, url, method, headers, item.file, (loaded) => {
      item.loaded = loaded;
      this.emit(item);
    });
  }

  async putParts(item) {
    const size = item.size;
    const { partSize, partCount } = item.upload;
    // Reprise : on demande au serveur quelles parties il possède déjà.
    const state = await api.get(`/files/${item.fileId}/upload`);
    const have = new Set((state.parts ?? []).map((p) => p.partNumber));
    const todo = [];
    for (let n = 1; n <= partCount; n++) if (!have.has(n)) todo.push(n);
    const progress = new Map();
    for (const n of have) progress.set(n, Math.min(partSize, size - (n - 1) * partSize));
    const update = () => {
      item.loaded = [...progress.values()].reduce((a, b) => a + b, 0);
      this.emit(item);
    };
    update();

    const urls = new Map();
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const signed = await api.post(`/files/${item.fileId}/upload/parts`, { partNumbers: batch });
      for (const p of signed.parts) urls.set(p.partNumber, p);
    }

    const queue = [...todo];
    const worker = async () => {
      while (queue.length && !item.canceled) {
        const n = queue.shift();
        const start = (n - 1) * partSize;
        const blob = item.file.slice(start, Math.min(start + partSize, size));
        let attempt = 0;
        for (;;) {
          try {
            const part = urls.get(n);
            await this.xhrPut(item, part.url, part.method, part.headers, blob, (loaded) => {
              progress.set(n, loaded);
              update();
            });
            progress.set(n, blob.size);
            update();
            break;
          } catch (err) {
            if (item.canceled) return;
            attempt += 1;
            if (attempt >= PART_RETRIES) throw err;
            progress.set(n, 0);
            await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
            // L'URL a peut-être expiré : on en redemande une fraîche pour cette partie.
            const fresh = await api.post(`/files/${item.fileId}/upload/parts`, { partNumbers: [n] });
            urls.set(n, fresh.parts[0]);
          }
        }
      }
    };
    const results = await Promise.allSettled(Array.from({ length: PART_PARALLEL }, worker));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
  }

  xhrPut(item, url, method, headers, body, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const controller = { abort: () => xhr.abort() };
      item.controllers.add(controller);
      xhr.open(method, url);
      for (const [k, v] of Object.entries(headers ?? {})) xhr.setRequestHeader(k, v);
      xhr.upload.addEventListener('progress', (e) => e.lengthComputable && onProgress(e.loaded));
      const fail = (message) => {
        item.controllers.delete(controller);
        reject(Object.assign(new Error(message), { name: 'PutError' }));
      };
      xhr.addEventListener('load', () => {
        item.controllers.delete(controller);
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else fail(xhr.status === 403 ? "L'envoi a expiré. Réessaie." : `Le stockage a refusé l'envoi (code ${xhr.status}).`);
      });
      xhr.addEventListener('error', () => fail('Connexion interrompue pendant l\'envoi. Réessaie pour reprendre.'));
      xhr.addEventListener('abort', () => {
        item.controllers.delete(controller);
        reject(Object.assign(new Error('Envoi annulé.'), { name: 'AbortError' }));
      });
      xhr.send(body);
    });
  }
}
