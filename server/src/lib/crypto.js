import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Jeton aléatoire imprévisible (256 bits), encodé base64url. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Hex aléatoire (clés de stockage : jamais dérivées d'un nom fourni par l'utilisateur). */
export const randomHex = (bytes = 16) => randomBytes(bytes).toString('hex');

/** Hash SHA-256 d'un jeton (sessions, partages, réinitialisation) : seul le hash est stocké. */
export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

export const hmacHex = (secret, value) => createHmac('sha256', secret).update(value).digest('hex');

export const hmacBase64Url = (secret, value) => createHmac('sha256', secret).update(value).digest('base64url');

/** Comparaison en temps constant de deux chaînes. */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
