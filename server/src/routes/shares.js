import { Router } from 'express';
import { schemas } from '../validators/schemas.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';

export function shareRoutes(ctx) {
  const r = Router();
  r.use(requireAuth);
  const { shares } = ctx;
  const writeLimit = rateLimit(ctx, { name: 'share-write', limit: 60, windowSeconds: 600 });

  r.get('/with-me', async (req, res) => res.json(await shares.sharedWithMe(req.user)));
  r.get('/by-me', async (req, res) => res.json(await shares.sharedByMe(req.user)));

  r.get('/', validate({ query: schemas.shareListQuery }), async (req, res) => {
    res.json(await shares.listForResource(req.user, req.valid.query));
  });

  r.post('/links', writeLimit, validate({ body: schemas.shareLinkCreate }), async (req, res) => {
    const out = await shares.createLink(req.user, req.valid.body);
    // Jamais le jeton dans les journaux : seulement l'identifiant du lien.
    await ctx.audit(req, { action: 'share.link_create', targetType: out.link.fileId ? 'file' : 'folder', targetId: out.link.fileId ?? out.link.folderId, meta: { linkId: out.link.id, canDownload: out.link.canDownload } });
    res.status(201).json(out);
  });

  r.delete('/links/:id', validate({ params: schemas.idParam }), async (req, res) => {
    await shares.revokeLink(req.user, req.valid.params.id);
    await ctx.audit(req, { action: 'share.link_revoke', meta: { linkId: req.valid.params.id } });
    res.status(204).end();
  });

  r.post('/grants', writeLimit, validate({ body: schemas.shareGrantCreate }), async (req, res) => {
    const out = await shares.createGrant(req.user, req.valid.body);
    await ctx.audit(req, { action: 'share.grant_create', targetType: req.valid.body.fileId ? 'file' : 'folder', targetId: req.valid.body.fileId ?? req.valid.body.folderId });
    res.status(202).json(out);
  });

  r.delete('/grants/:id', validate({ params: schemas.idParam }), async (req, res) => {
    await shares.revokeGrant(req.user, req.valid.params.id);
    await ctx.audit(req, { action: 'share.grant_revoke', meta: { grantId: req.valid.params.id } });
    res.status(204).end();
  });

  return r;
}

/** Accès anonyme par lien : jeton dans l'en-tête X-Share-Token (jamais dans l'URL ni dans les logs). */
export function publicRoutes(ctx) {
  const r = Router();
  const { access, shares, files } = ctx;
  r.use(rateLimit(ctx, { name: 'public-share', limit: 120, windowSeconds: 60 }));

  r.use(async (req, _res, next) => {
    req.link = await access.resolveLink(req.headers['x-share-token']);
    next();
  });

  r.get('/share', async (req, res) => res.json(await shares.publicRoot(req.link)));

  r.get('/share/folders/:id', validate({ params: schemas.idParam }), async (req, res) => {
    res.json(await shares.publicFolder(req.link, req.valid.params.id));
  });

  r.get('/share/files/:fileId/preview', validate({ params: schemas.publicFileParam }), async (req, res) => {
    const file = await shares.publicFile(req.link, req.valid.params.fileId);
    res.json(await files.preview(file));
  });

  r.get('/share/files/:fileId/download', validate({ params: schemas.publicFileParam, query: schemas.downloadQuery }), async (req, res) => {
    const file = await shares.publicFile(req.link, req.valid.params.fileId);
    const out = await files.downloadUrl(file, { canDownload: req.link.canDownload, inline: req.valid.query.inline === '1' });
    await ctx.audit(req, { userId: null, action: 'share.link_download', targetType: 'file', targetId: file.id, meta: { linkId: req.link.id } });
    res.json(out);
  });

  return r;
}
