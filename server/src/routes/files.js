import { Router } from 'express';
import { z } from 'zod';
import { schemas } from '../validators/schemas.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { fileDto, publicFileDto } from '../lib/dto.js';

export function fileRoutes(ctx) {
  const r = Router();
  r.use(requireAuth);
  const { files, access } = ctx;

  const uploadLimit = rateLimit(ctx, { name: 'upload-init', limit: 60, windowSeconds: 600 });
  const dlLimit = rateLimit(ctx, { name: 'download', limit: 120, windowSeconds: 60 });

  // --- Envoi : init → (parties) → complete. Les octets vont directement au stockage, jamais par cette API. ---
  r.post('/uploads', uploadLimit, validate({ body: schemas.uploadInit }), async (req, res) => {
    const out = await files.initUpload(req.user, req.valid.body);
    await ctx.audit(req, { action: 'upload.init', targetType: 'file', targetId: out.file.id, meta: { ext: out.file.extension } });
    res.status(201).json(out);
  });

  r.post('/:id/upload/parts', uploadLimit, validate({ params: schemas.idParam, body: schemas.uploadParts }), async (req, res) => {
    res.json(await files.presignParts(req.user, req.valid.params.id, req.valid.body.partNumbers));
  });

  r.get('/:id/upload', validate({ params: schemas.idParam }), async (req, res) => {
    res.json(await files.uploadState(req.user, req.valid.params.id));
  });

  r.post('/:id/complete', validate({ params: schemas.idParam, body: z.object({}).strict() }), async (req, res) => {
    res.json({ file: await files.completeUpload(req.user, req.valid.params.id) });
  });

  r.delete('/:id/upload', validate({ params: schemas.idParam }), async (req, res) => {
    await files.abortUpload(req.user, req.valid.params.id);
    res.status(204).end();
  });

  // --- Consultation ---
  r.get('/', validate({ query: schemas.fileList }), async (req, res) => {
    res.json(await files.list(req.user, req.valid.query));
  });

  r.get('/usage', async (req, res) => res.json(await files.usage(req.user)));

  r.get('/:id', validate({ params: schemas.idParam }), async (req, res) => {
    const a = await access.fileAccess(req.user, req.valid.params.id);
    res.json({
      file: a.level === 'owner' ? fileDto(a.file) : publicFileDto(a.file),
      access: { level: a.level, canDownload: a.canDownload },
    });
  });

  r.patch('/:id', validate({ params: schemas.idParam, body: schemas.fileUpdate }), async (req, res) => {
    res.json({ file: await files.update(req.user, req.valid.params.id, req.valid.body) });
  });

  r.delete('/:id', validate({ params: schemas.idParam }), async (req, res) => {
    await files.trash(req.user, req.valid.params.id);
    await ctx.audit(req, { action: 'file.trash', targetType: 'file', targetId: req.valid.params.id });
    res.status(204).end();
  });

  // --- Téléchargement et aperçu : droits vérifiés AVANT toute URL signée ---
  r.get('/:id/download', dlLimit, validate({ params: schemas.idParam, query: schemas.downloadQuery }), async (req, res) => {
    const a = await access.fileAccess(req.user, req.valid.params.id);
    const out = await files.downloadUrl(a.file, { canDownload: a.canDownload, inline: req.valid.query.inline === '1' });
    await ctx.audit(req, { action: 'file.download', targetType: 'file', targetId: a.file.id, meta: { level: a.level } });
    res.json(out);
  });

  r.get('/:id/preview', dlLimit, validate({ params: schemas.idParam }), async (req, res) => {
    const a = await access.fileAccess(req.user, req.valid.params.id);
    res.json(await files.preview(a.file));
  });

  return r;
}
