import { randomUUID } from 'node:crypto';
import { AppError } from '../lib/errors.js';

export function requestId(_req, res, next) {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export function apiNotFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } });
}

/**
 * Gestionnaire d'erreurs : messages sûrs seulement. Une erreur inattendue donne une réponse générique ;
 * les détails (jamais de stack ni de chemin) vont uniquement dans les logs serveur, avec l'identifiant de requête.
 */
export function errorHandler(ctx) {
  return (err, req, res, _next) => {
    const requestId = res.locals.requestId;
    if (res.headersSent) return res.destroy();

    if (err instanceof AppError) {
      if (err.status === 429 && err.details?.retryAfterSeconds) res.setHeader('Retry-After', String(err.details.retryAfterSeconds));
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Requête trop volumineuse.', requestId } });
    }
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Corps de requête illisible.', requestId } });
    }
    ctx.log.error('unhandled_error', { requestId, method: req.method, path: req.path, error: err?.message, name: err?.name });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: "Une erreur interne est survenue. Réessaie plus tard.", requestId } });
  };
}
