import helmet from 'helmet';
import { forbidden, tooManyRequests } from '../lib/errors.js';

/** En-têtes de sécurité (CSP stricte : aucun script ni style inline, aucune ressource tierce hors tuiles de carte). */
export function securityHeaders(config) {
  // Les tuiles sont servies depuis tile.openstreetmap.org (le joker « *. » ne couvre PAS le domaine nu).
  const tileHosts = ['https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'];
  const r2Hosts = config.storage.driver === 'r2' ? ['https://*.r2.cloudflarestorage.com'] : [];
  const mw = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:', ...tileHosts, ...r2Hosts],
        'font-src': ["'self'"],
        // L'API et les envois directs vers le stockage (URLs signées R2 : https uniquement)
        'connect-src': ["'self'", ...r2Hosts],
        'frame-src': ["'self'", ...r2Hosts],
        'object-src': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
        ...(config.isProd ? { 'upgrade-insecure-requests': [] } : {}),
      },
    },
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    xFrameOptions: { action: 'deny' },
  });
  return (req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    mw(req, res, next);
  };
}

/** Réponses d'API : jamais mises en cache (données privées), jamais interprétées comme autre chose que JSON. */
export function apiNoStore(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

/**
 * CORS restrictif : uniquement l'origine de l'application (même origine en pratique).
 * Aucune réponse « Access-Control-Allow-Origin: * ».
 */
export function strictCors(config) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && origin === config.appOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Share-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.status(origin === config.appOrigin ? 204 : 403).end();
    next();
  };
}

/** Limitation de débit par IP (+ clé optionnelle). */
export function rateLimit(ctx, { name, limit, windowSeconds, key }) {
  return async (req, res, next) => {
    const suffix = key ? key(req) : '';
    const result = await ctx.rateLimiter.hit(`${name}:${req.ip}:${suffix}`, limit, windowSeconds);
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfter));
      return next(tooManyRequests(result.retryAfter));
    }
    next();
  };
}

/** Pour les routes réservées au développement/tests. */
export function devOnly(config) {
  return (_req, _res, next) => (config.isProd || config.storage.driver !== 'local' ? next(forbidden()) : next());
}
