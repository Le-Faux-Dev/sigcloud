import { Router, raw } from 'express';
import { FORMATS, CATEGORIES } from '../config/policy.js';
import { safeEqual } from '../lib/crypto.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { devOnly } from '../middleware/security.js';

/** Santé, configuration publique et tâches planifiées. */
export function systemRoutes(ctx) {
  const r = Router();
  const { config, db } = ctx;

  r.get('/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });

  // Limites et formats utiles au client (rien de secret).
  r.get('/config', (_req, res) => {
    res.json({
      limits: { maxFileBytes: config.limits.maxFileBytes, previewMaxBytes: config.limits.previewMaxBytes, partSizeBytes: config.limits.partSizeBytes },
      categories: CATEGORIES,
      formats: Object.entries(FORMATS).map(([ext, f]) => ({ ext, label: f.label, category: f.category, previewable: Boolean(f.preview) })),
      features: { passwordResetByEmail: ctx.mailer.enabled },
    });
  });

  // Vercel Cron appelle en GET avec « Authorization: Bearer <CRON_SECRET> ».
  r.get('/cron/cleanup', async (req, res) => {
    if (!config.cronSecret) throw notFound();
    const header = req.headers.authorization ?? '';
    const sent = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!sent) throw unauthorized();
    if (!safeEqual(sent, config.cronSecret)) throw forbidden();
    const results = await ctx.cleanup.run();
    await ctx.audit(null, { userId: null, action: 'cron.cleanup', meta: { ok: true } });
    res.json({ ok: true, results });
  });

  // Développement uniquement : boîte d'envoi des e-mails simulés.
  r.get('/_dev/outbox', devOnly(config), (_req, res) => {
    if (config.mailDriver !== 'dev-outbox') throw notFound();
    res.json({ items: ctx.mailer.outbox });
  });

  return r;
}

/** Réception des octets pour le pilote de stockage LOCAL (jamais monté en production). */
export function localStorageRoutes(ctx) {
  const r = Router();
  const { storage, config } = ctx;
  r.use(devOnly(config));

  r.put('/upload', raw({ type: () => true, limit: config.limits.partSizeBytes + 1024 }), async (req, res) => {
    const payload = storage.verifyToken(req.query.token, 'put') ?? storage.verifyToken(req.query.token, 'part');
    if (!payload) throw forbidden('URL signée invalide ou expirée.');
    const { Readable } = await import('node:stream');
    try {
      await storage.receivePut(payload, Readable.from(req.body ?? Buffer.alloc(0)));
    } catch (err) {
      if (err?.code === 'TOO_LARGE' || err?.code === 'SIZE_MISMATCH') return res.status(400).json({ error: { code: err.code, message: 'Taille invalide.' } });
      throw err;
    }
    res.setHeader('ETag', `"ok"`);
    res.status(200).end();
  });

  r.get('/download', async (req, res) => {
    const payload = storage.verifyToken(req.query.token, 'get');
    if (!payload) throw forbidden('URL signée invalide ou expirée.');
    const { attachmentDisposition } = await import('../storage/r2.js');
    res.setHeader('Content-Type', payload.contentType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', attachmentDisposition(payload.filename, Boolean(payload.inline)));
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'private, no-store');
    const stream = await storage.openForDownload(payload.key);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  return r;
}
