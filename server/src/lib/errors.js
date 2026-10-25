// Erreurs applicatives : le message et le code sont SÛRS à renvoyer au client.
// Tout le reste (erreur inattendue) devient une réponse générique 500, détails dans les logs seulement.

export class AppError extends Error {
  /**
   * @param {number} status code HTTP
   * @param {string} code code machine stable (ex. QUOTA_EXCEEDED)
   * @param {string} message message en français, affichable à l'utilisateur
   * @param {Record<string, unknown>} [details] détails sûrs (jamais de chemin, secret ou trace)
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Authentification requise.') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'Action non autorisée.') => new AppError(403, 'FORBIDDEN', message);
// IDOR/BOLA : on répond 404 (et non 403) quand une ressource existe mais n'est pas accessible.
export const notFound = (message = 'Ressource introuvable.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (code, message, details) => new AppError(409, code, message, details);
export const gone = (code, message) => new AppError(410, code, message);
export const payloadTooLarge = (code, message, details) => new AppError(413, code, message, details);
export const unprocessable = (code, message, details) => new AppError(422, code, message, details);
export const tooManyRequests = (retryAfterSeconds) =>
  new AppError(429, 'RATE_LIMITED', 'Trop de tentatives. Réessaie dans quelques instants.', { retryAfterSeconds });
export const notImplemented = (code, message) => new AppError(501, code, message);
