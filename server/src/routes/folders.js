import { Router } from 'express';
import { z } from 'zod';
import { schemas } from '../validators/schemas.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

export function folderRoutes(ctx) {
  const r = Router();
  r.use(requireAuth);
  const { folders } = ctx;

  r.post('/', validate({ body: schemas.folderCreate }), async (req, res) => {
    res.status(201).json({ folder: await folders.create(req.user, req.valid.body) });
  });

  r.get('/:id/contents', validate({ params: schemas.folderContentsParam }), async (req, res) => {
    res.json(await folders.contents(req.user, req.valid.params.id));
  });

  r.patch('/:id', validate({ params: schemas.idParam, body: schemas.folderUpdate }), async (req, res) => {
    res.json({ folder: await folders.update(req.user, req.valid.params.id, req.valid.body) });
  });

  r.delete('/:id', validate({ params: schemas.idParam }), async (req, res) => {
    await folders.trash(req.user, req.valid.params.id);
    await ctx.audit(req, { action: 'folder.trash', targetType: 'folder', targetId: req.valid.params.id });
    res.status(204).end();
  });

  return r;
}

export function trashRoutes(ctx) {
  const r = Router();
  r.use(requireAuth);
  const { folders, files } = ctx;

  r.get('/', async (req, res) => res.json(await folders.listTrash(req.user)));

  r.post('/files/:id/restore', validate({ params: schemas.idParam }), async (req, res) => {
    res.json({ file: await files.restore(req.user, req.valid.params.id) });
  });
  r.delete('/files/:id', validate({ params: schemas.idParam }), async (req, res) => {
    await files.purge(req.user, req.valid.params.id);
    await ctx.audit(req, { action: 'file.purge', targetType: 'file', targetId: req.valid.params.id });
    res.status(204).end();
  });

  r.post('/folders/:id/restore', validate({ params: schemas.idParam, body: z.object({}).strict() }), async (req, res) => {
    res.json({ folder: await folders.restore(req.user, req.valid.params.id) });
  });
  r.delete('/folders/:id', validate({ params: schemas.idParam }), async (req, res) => {
    await folders.purge(req.user, req.valid.params.id);
    await ctx.audit(req, { action: 'folder.purge', targetType: 'folder', targetId: req.valid.params.id });
    res.status(204).end();
  });

  // Action destructive : confirmation explicite exigée dans le corps de la requête.
  r.post('/empty', validate({ body: schemas.trashEmpty }), async (req, res) => {
    const out = await folders.emptyTrash(req.user);
    await ctx.audit(req, { action: 'trash.empty', meta: out });
    res.json(out);
  });

  return r;
}
