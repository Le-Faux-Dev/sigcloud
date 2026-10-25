import { createHash } from 'node:crypto';
import { FORMATS, checkSignature, inspectName, sanitizeName } from '../config/policy.js';
import { randomHex } from '../lib/crypto.js';
import { conflict, notFound, forbidden, payloadTooLarge, unprocessable, badRequest } from '../lib/errors.js';
import { fileDto } from '../lib/dto.js';
import { analyzeGeoJsonText, analyzeKmlText, analyzeGpxText } from './geo.js';

const MAX_PENDING_UPLOADS = 20;
const TEXT_PREVIEW_BYTES = 64 * 1024;

const INLINE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
// Conteneurs : on ne vérifie que la signature, on n'ouvre rien → « non analysé en profondeur ».
const CONTAINER_SIGNATURES = new Set(['zip', 'sqlite', 'none']);

const REJECT_MESSAGES = {
  CONTENT_MISMATCH: "Le contenu du fichier ne correspond pas à son extension. Fichier refusé.",
  SIZE_MISMATCH: "La taille reçue ne correspond pas à la taille annoncée. Fichier refusé.",
  INVALID_JSON: "Ce fichier n'est pas un JSON valide. Fichier refusé.",
  INVALID_GEOJSON: "Ce fichier n'est pas un GeoJSON valide. Fichier refusé.",
  INVALID_KML: "Ce fichier n'est pas un KML valide. Fichier refusé.",
  INVALID_GPX: "Ce fichier n'est pas un GPX valide. Fichier refusé.",
  XML_DTD_FORBIDDEN: "Les déclarations DOCTYPE/ENTITY sont interdites dans un KML. Fichier refusé.",
};

const analyzeVector = (fmt, text, strict) => (fmt.preview === 'kml' ? analyzeKmlText(text) : fmt.preview === 'gpx' ? analyzeGpxText(text) : analyzeGeoJsonText(text, { strict }));

export function createFilesService(ctx) {
  const { db, config, storage, log } = ctx;
  const { partSizeBytes, maxFileBytes, previewMaxBytes } = config.limits;

  const releaseQuota = (ownerId, bytes) =>
    db.user.update({ where: { id: ownerId }, data: { usedBytes: { decrement: BigInt(bytes) } } });

  /** Supprime les objets de stockage (et transferts en cours). Les objets déjà absents sont ignorés. */
  async function deleteStored(files) {
    for (const f of files) {
      try {
        if (f.uploadStatus === 'UPLOADING' && f.multipartId) await storage.abortMultipart({ key: f.storageKey, uploadId: f.multipartId });
        await storage.delete(f.storageKey);
      } catch (err) {
        log.error('storage_delete_failed', { fileId: f.id, error: err?.message });
        throw err;
      }
    }
  }

  async function ownerFile(user, fileId, { pending = false } = {}) {
    const file = await db.fileAsset.findUnique({ where: { id: fileId } });
    if (!file || file.ownerId !== user.id) throw notFound();
    if (pending ? file.uploadStatus !== 'UPLOADING' : file.uploadStatus !== 'READY') {
      throw pending ? conflict('UPLOAD_ALREADY_COMPLETE', 'Ce transfert est déjà terminé.') : notFound();
    }
    return file;
  }

  async function ownedFolder(user, folderId) {
    if (!folderId) return null;
    const folder = await db.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.ownerId !== user.id || folder.deletedAt) throw notFound('Dossier introuvable.');
    return folder;
  }

  const partCountFor = (size) => Math.max(1, Math.ceil(size / partSizeBytes));
  const partSizeFor = (size, partNumber) => {
    const count = partCountFor(size);
    return partNumber < count ? partSizeBytes : size - (count - 1) * partSizeBytes;
  };

  async function reject(file, code, extraMeta) {
    await deleteStored([file]).catch(() => {});
    await db.$transaction([db.fileAsset.delete({ where: { id: file.id } }), db.user.update({ where: { id: file.ownerId }, data: { usedBytes: { decrement: file.sizeBytes } } })]);
    ctx.audit(null, { userId: file.ownerId, action: 'upload.rejected', targetType: 'file', targetId: file.id, meta: { code, ...extraMeta } });
    throw unprocessable(code, REJECT_MESSAGES[code] ?? 'Fichier refusé.');
  }

  return {
    deleteStored,
    releaseQuota,

    /** Étape 1 : réserve le quota, crée l'entrée « en cours » et prépare l'envoi direct vers le stockage. */
    async initUpload(user, { name: rawName, size, folderId }) {
      const name = sanitizeName(rawName);
      const info = inspectName(name);
      if (!info.ok) {
        const messages = {
          NO_EXTENSION: 'Le nom du fichier doit avoir une extension.',
          FORMAT_DEFERRED: `Le format .${info.ext} n'est pas pris en charge dans cette version.`,
          FORMAT_NOT_ALLOWED: `Le format .${info.ext ?? ''} n'est pas autorisé.`,
        };
        throw unprocessable(info.code, messages[info.code]);
      }
      if (size > maxFileBytes) {
        throw payloadTooLarge('FILE_TOO_LARGE', `Fichier trop volumineux (maximum ${Math.floor(maxFileBytes / 1024 / 1024)} Mo).`, { maxFileBytes });
      }
      await ownedFolder(user, folderId ?? null);

      const storageKey = `${randomHex(2)}/${randomHex(16)}`;
      const file = await db.$transaction(async (tx) => {
        // Verrou sur la ligne utilisateur : deux envois simultanés ne peuvent pas dépasser le quota ensemble.
        const [row] = await tx.$queryRaw`SELECT "usedBytes", "quotaBytes" FROM users WHERE "id" = ${user.id} FOR UPDATE`;
        if (row.usedBytes + BigInt(size) > row.quotaBytes) {
          throw payloadTooLarge('QUOTA_EXCEEDED', "Quota de stockage dépassé.", { usedBytes: Number(row.usedBytes), quotaBytes: Number(row.quotaBytes) });
        }
        const pending = await tx.fileAsset.count({ where: { ownerId: user.id, uploadStatus: 'UPLOADING' } });
        if (pending >= MAX_PENDING_UPLOADS) {
          throw conflict('TOO_MANY_PENDING_UPLOADS', 'Trop de transferts en cours. Termine ou annule des envois.');
        }
        const created = await tx.fileAsset.create({
          data: { ownerId: user.id, folderId: folderId ?? null, name, extension: info.ext, sizeBytes: BigInt(size), storageKey },
        });
        await tx.user.update({ where: { id: user.id }, data: { usedBytes: { increment: BigInt(size) } } });
        return created;
      });

      try {
        const ttl = config.limits.uploadUrlTtl;
        if (size <= partSizeBytes) {
          const upload = await storage.presignPutObject({ key: storageKey, size, ttl });
          return { file: fileDto(file), upload: { mode: 'single', ...upload, expiresInSeconds: ttl } };
        }
        const { uploadId } = await storage.createMultipart(storageKey);
        await db.fileAsset.update({ where: { id: file.id }, data: { multipartId: uploadId } });
        return {
          file: fileDto(file),
          upload: { mode: 'multipart', partSize: partSizeBytes, partCount: partCountFor(size), expiresInSeconds: ttl },
        };
      } catch (err) {
        // Échec côté stockage : on libère la réservation de quota.
        await db.$transaction([db.fileAsset.delete({ where: { id: file.id } }), db.user.update({ where: { id: user.id }, data: { usedBytes: { decrement: BigInt(size) } } })]);
        throw err;
      }
    },

    /** URLs signées pour des parties précises (reprise possible : on ne redemande que les parties manquantes). */
    async presignParts(user, fileId, partNumbers) {
      const file = await ownerFile(user, fileId, { pending: true });
      if (!file.multipartId) throw badRequest('NOT_MULTIPART', "Ce transfert n'utilise pas l'envoi en plusieurs parties.");
      const size = Number(file.sizeBytes);
      const count = partCountFor(size);
      const unique = [...new Set(partNumbers)];
      if (unique.some((n) => n > count)) throw badRequest('INVALID_PART', 'Numéro de partie invalide.');
      const ttl = config.limits.uploadUrlTtl;
      const parts = await Promise.all(
        unique.map(async (partNumber) => {
          const expected = partSizeFor(size, partNumber);
          const signed = await storage.presignUploadPart({ key: file.storageKey, uploadId: file.multipartId, partNumber, size: expected, ttl });
          return { partNumber, size: expected, ...signed };
        }),
      );
      return { parts, expiresInSeconds: ttl };
    },

    /** État d'un transfert (parties déjà reçues) : sert à reprendre après une coupure réseau. */
    async uploadState(user, fileId) {
      const file = await ownerFile(user, fileId, { pending: true });
      const size = Number(file.sizeBytes);
      if (!file.multipartId) {
        return { mode: 'single', size, uploaded: Boolean(await storage.head(file.storageKey)) };
      }
      const parts = await storage.listParts({ key: file.storageKey, uploadId: file.multipartId });
      return {
        mode: 'multipart',
        size,
        partSize: partSizeBytes,
        partCount: partCountFor(size),
        parts: parts.map((p) => ({ partNumber: p.partNumber, size: p.size })),
      };
    },

    /** Étape finale : assemblage, puis VÉRIFICATION CÔTÉ SERVEUR du contenu réel (taille, signature, structure). */
    async completeUpload(user, fileId) {
      const existing = await db.fileAsset.findUnique({ where: { id: fileId } });
      if (!existing || existing.ownerId !== user.id) throw notFound();
      if (existing.uploadStatus === 'READY') return fileDto(existing); // idempotent
      const file = existing;
      const size = Number(file.sizeBytes);
      const fmt = FORMATS[file.extension];

      if (file.multipartId) {
        const parts = await storage.listParts({ key: file.storageKey, uploadId: file.multipartId });
        const expected = partCountFor(size);
        const complete = parts.length === expected && parts.every((p) => p.partNumber >= 1 && p.partNumber <= expected && p.size === partSizeFor(size, p.partNumber));
        if (!complete) throw conflict('UPLOAD_INCOMPLETE', "Toutes les parties n'ont pas été reçues.", { received: parts.map((p) => p.partNumber) });
        await storage.completeMultipart({ key: file.storageKey, uploadId: file.multipartId });
      }

      const head = await storage.head(file.storageKey);
      if (!head) throw conflict('UPLOAD_MISSING', "Le fichier n'a pas été reçu par le stockage.");
      if (head.size !== size) return reject(file, 'SIZE_MISMATCH', { declared: size, received: head.size });

      // Lecture unique en flux : hash complet + premiers octets + (si aperçu possible) contenu pour analyse.
      const needText = size <= previewMaxBytes && (['geojson', 'kml', 'gpx'].includes(fmt.preview));
      const hash = createHash('sha256');
      const chunks = [];
      let headBytes = Buffer.alloc(0);
      let total = 0;
      for await (const chunk of await storage.readStream(file.storageKey)) {
        hash.update(chunk);
        total += chunk.length;
        if (headBytes.length < 8192) headBytes = Buffer.concat([headBytes, chunk.subarray(0, 8192 - headBytes.length)]);
        if (needText) chunks.push(chunk);
      }
      if (total !== size) return reject(file, 'SIZE_MISMATCH', { declared: size, received: total });

      const sig = checkSignature(fmt.signature, headBytes);
      if (!sig.ok) return reject(file, 'CONTENT_MISMATCH', { ext: file.extension });

      let previewStatus = 'NONE';
      let previewReason = null;
      let geoMeta = null;

      if (['geojson', 'kml', 'gpx'].includes(fmt.preview)) {
        if (size > previewMaxBytes) {
          previewStatus = 'UNSUPPORTED';
          previewReason = 'TOO_LARGE';
        } else {
          const text = Buffer.concat(chunks).toString('utf8');
          const result = analyzeVector(fmt, text, file.extension === 'geojson');
          if (!result.ok) return reject(file, result.reason);
          if (result.previewable) {
            previewStatus = 'PREVIEWABLE';
            geoMeta = result.meta;
          } else {
            previewStatus = 'UNSUPPORTED';
            previewReason = result.reason;
          }
        }
      } else if (fmt.preview) {
        previewStatus = 'PREVIEWABLE'; // image, texte, pdf : signature vérifiée
      }

      const securityStatus = CONTAINER_SIGNATURES.has(fmt.signature) ? 'NOT_DEEP_SCANNED' : 'FORMAT_VERIFIED';
      const ready = await db.fileAsset.update({
        where: { id: file.id },
        data: {
          uploadStatus: 'READY',
          multipartId: null,
          securityStatus,
          previewStatus,
          previewReason,
          detectedType: sig.detected,
          sha256: hash.digest('hex'),
          geoMeta: geoMeta ?? undefined,
        },
      });
      ctx.audit(null, { userId: user.id, action: 'upload.complete', targetType: 'file', targetId: file.id, meta: { ext: file.extension, size } });
      return fileDto(ready);
    },

    async abortUpload(user, fileId) {
      const file = await ownerFile(user, fileId, { pending: true });
      await deleteStored([file]);
      await db.$transaction([db.fileAsset.delete({ where: { id: file.id } }), db.user.update({ where: { id: user.id }, data: { usedBytes: { decrement: file.sizeBytes } } })]);
    },

    async list(user, q) {
      const where = { ownerId: user.id, uploadStatus: 'READY', deletedAt: null };
      if (q.folderId === 'root') where.folderId = null;
      else if (q.folderId !== 'all') where.folderId = q.folderId;
      if (q.q) where.OR = [{ name: { contains: q.q, mode: 'insensitive' } }, { tags: { has: q.q.toLowerCase() } }];
      const inCategory = q.category ? Object.keys(FORMATS).filter((e) => FORMATS[e].category === q.category) : null;
      if (q.ext) where.extension = inCategory && !inCategory.includes(q.ext) ? '__aucun__' : q.ext;
      else if (inCategory) where.extension = { in: inCategory };
      if (q.preview) where.previewStatus = q.preview === 'yes' ? 'PREVIEWABLE' : { not: 'PREVIEWABLE' };
      if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) };
      const orderField = { name: 'name', size: 'sizeBytes', date: 'createdAt' }[q.sort];
      const [items, total] = await Promise.all([
        db.fileAsset.findMany({ where, orderBy: [{ [orderField]: q.order }, { id: 'asc' }], take: q.limit, skip: q.offset }),
        db.fileAsset.count({ where }),
      ]);
      return { items: items.map(fileDto), total, limit: q.limit, offset: q.offset };
    },

    /** Utilisation réelle du stockage par catégorie (sommes calculées en base). */
    async usage(user) {
      const [rows, trashed, me] = await Promise.all([
        db.fileAsset.groupBy({ by: ['extension'], where: { ownerId: user.id, uploadStatus: 'READY', deletedAt: null }, _sum: { sizeBytes: true }, _count: { _all: true } }),
        db.fileAsset.aggregate({ where: { ownerId: user.id, deletedAt: { not: null } }, _sum: { sizeBytes: true }, _count: { _all: true } }),
        db.user.findUnique({ where: { id: user.id }, select: { usedBytes: true, quotaBytes: true } }),
      ]);
      const byCategory = {};
      for (const r of rows) {
        const cat = FORMATS[r.extension]?.category ?? 'document';
        const cur = (byCategory[cat] ??= { bytes: 0, count: 0 });
        cur.bytes += Number(r._sum.sizeBytes ?? 0n);
        cur.count += r._count._all;
      }
      return {
        usedBytes: Number(me.usedBytes),
        quotaBytes: Number(me.quotaBytes),
        trashBytes: Number(trashed._sum.sizeBytes ?? 0n),
        trashCount: trashed._count._all,
        byCategory,
      };
    },

    async update(user, fileId, patch) {
      const file = await ownerFile(user, fileId);
      const data = {};
      if (patch.name !== undefined) {
        const name = sanitizeName(patch.name);
        const info = inspectName(name);
        if (!info.ok || info.ext !== file.extension) {
          throw unprocessable('EXTENSION_CHANGE_FORBIDDEN', "L'extension du fichier ne peut pas être modifiée.");
        }
        data.name = name;
      }
      if (patch.description !== undefined) data.description = patch.description;
      if (patch.tags !== undefined) data.tags = [...new Set(patch.tags.map((t) => t.toLowerCase()))];
      if (patch.folderId !== undefined) {
        await ownedFolder(user, patch.folderId);
        data.folderId = patch.folderId;
      }
      return fileDto(await db.fileAsset.update({ where: { id: file.id }, data }));
    },

    async trash(user, fileId) {
      const file = await ownerFile(user, fileId);
      await db.fileAsset.update({ where: { id: file.id }, data: { deletedAt: new Date(), trashBatchId: randomHex(8), trashRoot: true } });
    },

    async restore(user, fileId) {
      const file = await db.fileAsset.findUnique({ where: { id: fileId } });
      if (!file || file.ownerId !== user.id || !file.deletedAt || !file.trashRoot) throw notFound();
      let folderId = file.folderId;
      if (folderId) {
        const parent = await db.folder.findUnique({ where: { id: folderId } });
        if (!parent || parent.deletedAt) folderId = null; // le dossier d'origine n'est plus disponible : retour à la racine
      }
      return fileDto(await db.fileAsset.update({ where: { id: file.id }, data: { deletedAt: null, trashBatchId: null, trashRoot: false, folderId } }));
    },

    /** Suppression définitive d'un fichier de la corbeille (objet de stockage, puis base, puis quota). */
    async purge(user, fileId) {
      const file = await db.fileAsset.findUnique({ where: { id: fileId } });
      if (!file || file.ownerId !== user.id || !file.deletedAt || !file.trashRoot) throw notFound();
      await this.purgeRows([file]);
    },

    async purgeRows(files) {
      if (!files.length) return;
      await deleteStored(files);
      const byOwner = new Map();
      for (const f of files) byOwner.set(f.ownerId, (byOwner.get(f.ownerId) ?? 0n) + f.sizeBytes);
      await db.fileAsset.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
      for (const [ownerId, bytes] of byOwner) await releaseQuota(ownerId, bytes);
    },

    async purgeAllForOwner(ownerId) {
      for (;;) {
        const batch = await db.fileAsset.findMany({ where: { ownerId }, take: 200 });
        if (!batch.length) return;
        await deleteStored(batch);
        await db.fileAsset.deleteMany({ where: { id: { in: batch.map((f) => f.id) } } });
      }
    },

    /** URL de téléchargement signée, de courte durée, générée APRÈS la vérification des droits. */
    async downloadUrl(file, { canDownload, inline = false }) {
      if (!canDownload) throw forbidden("Tu n'as pas la permission de télécharger ce fichier.");
      const contentType = inline ? INLINE_TYPES[file.extension] : undefined;
      if (inline && !contentType) throw badRequest('NOT_INLINE', "Ce format ne peut pas être affiché en ligne.");
      const ttl = config.limits.signedUrlTtl;
      const url = await storage.presignDownload({ key: file.storageKey, filename: file.name, ttl, inline, contentType });
      return { url, expiresInSeconds: ttl };
    },

    /** Contenu d'aperçu (jamais le fichier brut au-delà du seuil d'aperçu). */
    async preview(file) {
      const fmt = FORMATS[file.extension];
      if (file.previewStatus !== 'PREVIEWABLE' || !fmt.preview) {
        throw unprocessable('NOT_PREVIEWABLE', "Ce fichier est stocké mais ne peut pas être prévisualisé dans le navigateur.", { reason: file.previewReason });
      }
      const ttl = config.limits.signedUrlTtl;
      if (fmt.preview === 'image' || fmt.preview === 'pdf') {
        const url = await storage.presignDownload({ key: file.storageKey, filename: file.name, ttl, inline: true, contentType: INLINE_TYPES[file.extension] });
        return { kind: fmt.preview, url, expiresInSeconds: ttl };
      }
      if (fmt.preview === 'text') {
        const buf = await storage.readRange(file.storageKey, 0, TEXT_PREVIEW_BYTES - 1);
        return { kind: 'text', text: new TextDecoder('utf-8', { fatal: false }).decode(buf), truncated: Number(file.sizeBytes) > TEXT_PREVIEW_BYTES };
      }
      // geojson / kml : relecture, revalidation et assainissement côté serveur à chaque aperçu
      const chunks = [];
      for await (const c of await storage.readStream(file.storageKey)) chunks.push(c);
      const text = Buffer.concat(chunks).toString('utf8');
      const result = analyzeVector(fmt, text, false);
      if (!result.ok || !result.previewable) throw unprocessable('NOT_PREVIEWABLE', "Ce fichier ne peut pas être prévisualisé.", { reason: result.reason });
      return { kind: 'geojson', data: result.featureCollection, meta: result.meta };
    },
  };
}
