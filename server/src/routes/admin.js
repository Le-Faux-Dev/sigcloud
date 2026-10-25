import { Router } from 'express';
import { schemas } from '../validators/schemas.js';
import { validate } from '../middleware/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';

export function adminRoutes(ctx) {
  const r = Router();
  r.use(requireAdmin, rateLimit(ctx, { name: 'admin', limit: 120, windowSeconds: 60 }));
  const { admin } = ctx;

  r.get('/stats', async (_req, res) => res.json(await admin.stats()));

  r.get('/users', validate({ query: schemas.adminList }), async (req, res) => {
    res.json(await admin.listUsers(req.valid.query));
  });

  r.patch('/users/:id', validate({ params: schemas.idParam, body: schemas.adminUserUpdate }), async (req, res) => {
    const out = await admin.updateUser(req.user, req.valid.params.id, req.valid.body);
    await ctx.audit(req, { action: 'admin.user_update', targetType: 'user', targetId: req.valid.params.id, meta: { quotaChanged: req.valid.body.quotaBytes !== undefined, disabled: req.valid.body.disabled ?? null } });
    res.json(out);
  });

  r.get('/audit', validate({ query: schemas.adminList }), async (req, res) => {
    res.json(await admin.auditList(req.valid.query));
  });

  return r;
}
