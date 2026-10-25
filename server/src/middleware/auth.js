import { parseCookies, sessionCookieName } from '../lib/cookies.js';
import { sha256Hex, safeEqual } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';

const TOUCH_EVERY_MS = 5 * 60 * 1000;

/** Charge la session depuis le cookie. N'échoue pas : req.user reste indéfini si non authentifié. */
export function loadSession(ctx) {
  const cookieName = sessionCookieName(ctx.config);
  return async (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token || token.length > 200) return next();
    const session = await ctx.db.session.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: true },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now || session.user.disabledAt) return next();
    req.session = session;
    req.user = session.user;
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      // Mise à jour opportuniste ; une erreur ici ne doit pas faire échouer la requête.
      ctx.db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => {});
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  // Contrôle côté serveur à chaque requête : le rôle vient de la base, jamais du client.
  if (req.user.role !== 'ADMIN') return next(forbidden());
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Protection CSRF pour les cookies de session :
 *  1) si l'en-tête Origin est présent, il doit être celui de l'application ;
 *  2) pour toute requête modifiante authentifiée, le jeton CSRF (en-tête X-CSRF-Token) de la session est exigé.
 */
export function csrfProtection(ctx) {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && origin !== ctx.config.appOrigin) return next(forbidden('Origine de la requête refusée.'));
    if (req.session) {
      const sent = req.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !safeEqual(sent, req.session.csrfToken)) {
        return next(forbidden('Jeton CSRF manquant ou invalide.'));
      }
    }
    next();
  };
}
