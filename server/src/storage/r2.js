import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Pilote Cloudflare R2 (API compatible S3). Le bucket doit être PRIVÉ : aucun accès public, aucun domaine r2.dev.
// ATTENTION : ce pilote n'a pas été testé contre un vrai bucket R2 (pas d'identifiants dans l'environnement de
// construction). Les URLs signées sont générées hors ligne et testées ; voir docs/TEST_PLAN.md pour la
// vérification manuelle à faire avec ton bucket.

/** Valeur sûre pour l'en-tête Content-Disposition (RFC 6266 / 5987). */
export function attachmentDisposition(filename, inline = false) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export function createR2Storage(config) {
  const { r2 } = config.storage;
  const client = new S3Client({
    region: 'auto',
    endpoint: r2.endpoint,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  const Bucket = r2.bucket;

  return {
    driver: 'r2',
    client,

    async presignPutObject({ key, size, ttl }) {
      const cmd = new PutObjectCommand({ Bucket, Key: key, ContentLength: size, ContentType: 'application/octet-stream' });
      const url = await getSignedUrl(client, cmd, { expiresIn: ttl, signableHeaders: new Set(['content-length', 'content-type']) });
      return { url, method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' } };
    },

    async createMultipart(key) {
      const out = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: 'application/octet-stream' }));
      return { uploadId: out.UploadId };
    },

    async presignUploadPart({ key, uploadId, partNumber, size, ttl }) {
      const cmd = new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, ContentLength: size });
      const url = await getSignedUrl(client, cmd, { expiresIn: ttl, signableHeaders: new Set(['content-length']) });
      return { url, method: 'PUT', headers: {} };
    },

    async listParts({ key, uploadId }) {
      const parts = [];
      let marker;
      do {
        const out = await client.send(new ListPartsCommand({ Bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }));
        for (const p of out.Parts ?? []) parts.push({ partNumber: p.PartNumber, size: Number(p.Size), etag: p.ETag });
        marker = out.IsTruncated ? out.NextPartNumberMarker : undefined;
      } while (marker);
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },

    async completeMultipart({ key, uploadId }) {
      // Les parties font foi côté stockage (ListParts), jamais la liste envoyée par le navigateur.
      const parts = await this.listParts({ key, uploadId });
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }),
      );
    },

    async abortMultipart({ key, uploadId }) {
      try {
        await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }));
      } catch (err) {
        if (err?.name !== 'NoSuchUpload') throw err;
      }
    },

    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: Number(out.ContentLength) };
      } catch (err) {
        if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
        throw err;
      }
    },

    async readStream(key) {
      const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return out.Body;
    },

    async readRange(key, start, end) {
      const out = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=${start}-${end}` }));
      return Buffer.from(await out.Body.transformToByteArray());
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },

    async presignDownload({ key, filename, ttl, inline = false, contentType }) {
      const cmd = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentDisposition: attachmentDisposition(filename, inline),
        // Jamais le type fourni par l'utilisateur : soit un type d'image/PDF vérifié, soit un flux binaire.
        ResponseContentType: contentType ?? 'application/octet-stream',
      });
      return getSignedUrl(client, cmd, { expiresIn: ttl });
    },
  };
}
