/** Nom du cookie de session : préfixe __Host- (HTTPS, Path=/, sans Domain) dès que le cookie est Secure. */
export const sessionCookieName = (config) => (config.cookieSecure ? '__Host-sid' : 'sid');

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        /* cookie mal formé : ignoré */
      }
    }
  }
  return out;
}

export function setSessionCookie(res, config, token, maxAgeMs) {
  res.cookie(sessionCookieName(config), token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(res, config) {
  res.clearCookie(sessionCookieName(config), { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', path: '/' });
}
