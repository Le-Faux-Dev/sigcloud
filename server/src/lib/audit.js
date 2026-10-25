import { hmacHex } from './crypto.js';

/** IP hachée avec un secret (jamais l'IP en clair dans les journaux). */
export const hashIp = (config, ip) => (ip ? hmacHex(config.appSecret, `ip:${ip}`).slice(0, 32) : null);

const FORBIDDEN_META_KEYS = /pass|token|secret|authorization|cookie|url|signature/i;

function cleanMeta(meta) {
  if (!meta) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_META_KEYS.test(k)) continue; // garde-fou : on n'enregistre jamais un secret par erreur
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Écrit une ligne dans le journal d'audit. N'échoue jamais bruyamment (le journal ne doit pas casser une requête).
 * @param {{db: any, config: any, log: any}} ctx
 */
export async function audit(ctx, req, { userId, action, targetType, targetId, meta }) {
  try {
    await ctx.db.auditLog.create({
      data: {
        userId: userId ?? req?.user?.id ?? null,
        action,
        targetType: targetType ?? null,
        targetId: targetId ?? null,
        meta: cleanMeta(meta),
        ipHash: hashIp(ctx.config, req?.ip),
      },
    });
  } catch (err) {
    ctx.log.error('audit_write_failed', { action, error: err?.message });
  }
}
