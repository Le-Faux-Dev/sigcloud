import { Router } from 'express';
import { schemas } from '../validators/schemas.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { clearSessionCookie, setSessionCookie } from '../lib/cookies.js';
import { userDto } from '../lib/dto.js';

export function authRoutes(ctx) {
  const r = Router();
  const { auth, config } = ctx;

  const respondSession = (res, req, { user, token, session }, status = 200) => {
    setSessionCookie(res, config, token, config.sessionTtlMs);
    res.status(status).json({ user: userDto(user), csrfToken: session.csrfToken });
  };

  r.post(
    '/register',
    rateLimit(ctx, { name: 'register', limit: 5, windowSeconds: 3600 }),
    validate({ body: schemas.register }),
    async (req, res) => {
      const result = await auth.register(req, req.valid.body);
      await ctx.audit(req, { userId: result.user.id, action: 'auth.register' });
      respondSession(res, req, result, 201);
    },
  );

  r.post(
    '/login',
    rateLimit(ctx, { name: 'login-ip', limit: 60, windowSeconds: 900 }),
    validate({ body: schemas.login }),
    // Limite par IP + e-mail : freine la force brute sur un compte sans permettre de verrouiller un compte tiers.
    (req, res, next) => rateLimit(ctx, { name: 'login-acct', limit: 8, windowSeconds: 900, key: () => req.valid.body.email })(req, res, next),
    async (req, res) => {
      try {
        const result = await auth.login(req, req.valid.body);
        await ctx.audit(req, { userId: result.user.id, action: 'auth.login' });
        respondSession(res, req, result);
      } catch (err) {
        if (err.code === 'INVALID_CREDENTIALS') await ctx.audit(req, { action: 'auth.login_failed' });
        throw err;
      }
    },
  );

  r.post('/logout', requireAuth, async (req, res) => {
    await auth.logout(req.session);
    await ctx.audit(req, { action: 'auth.logout' });
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  r.get('/me', requireAuth, (req, res) => {
    res.json({ user: userDto(req.user), csrfToken: req.session.csrfToken });
  });

  r.patch('/me', requireAuth, validate({ body: schemas.updateProfile }), async (req, res) => {
    res.json({ user: userDto(await auth.updateProfile(req.user, req.valid.body)) });
  });

  r.post(
    '/change-password',
    requireAuth,
    rateLimit(ctx, { name: 'chpw', limit: 10, windowSeconds: 3600 }),
    validate({ body: schemas.changePassword }),
    async (req, res) => {
      await auth.changePassword(req.user, req.session, req.valid.body);
      await ctx.audit(req, { action: 'auth.password_changed' });
      res.status(204).end();
    },
  );

  r.get('/sessions', requireAuth, async (req, res) => {
    res.json({ items: await auth.listSessions(req.user, req.session.id) });
  });

  r.delete('/sessions/:id', requireAuth, validate({ params: schemas.sessionParam }), async (req, res) => {
    await auth.revokeSession(req.user, req.valid.params.id);
    await ctx.audit(req, { action: 'auth.session_revoked' });
    res.status(204).end();
  });

  r.post(
    '/password-reset/request',
    rateLimit(ctx, { name: 'pwreset', limit: 5, windowSeconds: 3600 }),
    validate({ body: schemas.resetRequest }),
    async (req, res) => {
      await auth.requestPasswordReset(req.valid.body.email);
      // Réponse identique que le compte existe ou non.
      res.status(202).json({ message: 'Si un compte existe avec cette adresse, un e-mail vient d\'être envoyé.' });
    },
  );

  r.post(
    '/password-reset/confirm',
    rateLimit(ctx, { name: 'pwreset-confirm', limit: 10, windowSeconds: 3600 }),
    validate({ body: schemas.resetConfirm }),
    async (req, res) => {
      const user = await auth.confirmPasswordReset(req.valid.body);
      await ctx.audit(req, { userId: user.id, action: 'auth.password_reset' });
      res.status(204).end();
    },
  );

  r.get('/export', requireAuth, rateLimit(ctx, { name: 'export', limit: 5, windowSeconds: 3600 }), async (req, res) => {
    await ctx.audit(req, { action: 'account.export' });
    res.setHeader('Content-Disposition', 'attachment; filename="sig-cloud-export.json"');
    res.json(await auth.exportData(req.user));
  });

  r.delete(
    '/me',
    requireAuth,
    rateLimit(ctx, { name: 'delacct', limit: 5, windowSeconds: 3600 }),
    validate({ body: schemas.deleteAccount }),
    async (req, res) => {
      const userId = req.user.id;
      await auth.deleteAccount(req.user, req.valid.body);
      await ctx.audit(req, { userId: null, action: 'account.deleted', meta: { was: userId.slice(0, 8) } });
      clearSessionCookie(res, config);
      res.status(204).end();
    },
  );

  return r;
}
