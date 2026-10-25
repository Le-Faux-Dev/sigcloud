import { z } from 'zod';

const bool = (v) => v === '1' || v === 'true';
const int = (def) => z.coerce.number().int().positive().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(3000),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  APP_SECRET: z.string().min(32, 'APP_SECRET doit contenir au moins 32 caractères'),

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: int(5),

  STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),

  MAX_FILE_BYTES: int(50 * 1024 * 1024),
  DEFAULT_QUOTA_BYTES: int(1024 * 1024 * 1024),
  PREVIEW_MAX_BYTES: int(10 * 1024 * 1024),
  PART_SIZE_BYTES: int(8 * 1024 * 1024),
  SIGNED_URL_TTL_SECONDS: int(300),
  UPLOAD_URL_TTL_SECONDS: int(900),

  SESSION_TTL_DAYS: int(14),

  RATE_LIMIT_STORE: z.enum(['memory', 'postgres', 'upstash']).default('memory'),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  CRON_SECRET: z.string().optional(),
  MAIL_DRIVER: z.enum(['none', 'dev-outbox']).default('none'),
});

/**
 * Charge et valide la configuration. Lève une erreur lisible (sans afficher de valeur secrète).
 * @param {Record<string, string | undefined>} source
 */
export function loadConfig(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuration invalide :\n  ${problems}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === 'production';

  // Garde-fous de production : on refuse de démarrer dans une configuration dangereuse.
  if (isProd) {
    const errors = [];
    if (c.STORAGE_DRIVER !== 'r2') errors.push('STORAGE_DRIVER doit valoir "r2" en production');
    if (c.MAIL_DRIVER === 'dev-outbox') errors.push('MAIL_DRIVER=dev-outbox est interdit en production');
    if (!c.APP_ORIGIN.startsWith('https://')) errors.push('APP_ORIGIN doit être en https en production');
    if (!c.CRON_SECRET || c.CRON_SECRET.length < 32) errors.push('CRON_SECRET (≥ 32 caractères) est requis en production');
    if (/CHANGE_ME/i.test(c.APP_SECRET)) errors.push('APP_SECRET est encore une valeur d\'exemple');
    if (c.RATE_LIMIT_STORE === 'memory') errors.push('RATE_LIMIT_STORE=memory est interdit en production (serverless)');
    if (errors.length) throw new Error(`Configuration de production refusée :\n  ${errors.join('\n  ')}`);
  }
  if (c.STORAGE_DRIVER === 'r2') {
    const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'].filter((k) => !c[k]);
    if (missing.length) throw new Error(`Variables R2 manquantes : ${missing.join(', ')}`);
  }
  if (c.RATE_LIMIT_STORE === 'upstash' && (!c.UPSTASH_REDIS_REST_URL || !c.UPSTASH_REDIS_REST_TOKEN)) {
    throw new Error('UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN sont requis avec RATE_LIMIT_STORE=upstash');
  }
  if (c.PART_SIZE_BYTES < 5 * 1024 * 1024) {
    throw new Error('PART_SIZE_BYTES doit être ≥ 5 Mo (minimum imposé par S3/R2 pour les parties intermédiaires)');
  }

  return Object.freeze({
    env: c.NODE_ENV,
    isProd,
    isTest: c.NODE_ENV === 'test',
    port: c.PORT,
    appOrigin: c.APP_ORIGIN.replace(/\/$/, ''),
    trustProxy: c.TRUST_PROXY,
    appSecret: c.APP_SECRET,
    databaseUrl: c.DATABASE_URL,
    dbPoolMax: c.DB_POOL_MAX,
    storage: Object.freeze({
      driver: c.STORAGE_DRIVER,
      localDir: c.LOCAL_STORAGE_DIR,
      r2: Object.freeze({
        accountId: c.R2_ACCOUNT_ID,
        accessKeyId: c.R2_ACCESS_KEY_ID,
        secretAccessKey: c.R2_SECRET_ACCESS_KEY,
        bucket: c.R2_BUCKET,
        endpoint: c.R2_ENDPOINT || (c.R2_ACCOUNT_ID ? `https://${c.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined),
      }),
    }),
    limits: Object.freeze({
      maxFileBytes: c.MAX_FILE_BYTES,
      defaultQuotaBytes: c.DEFAULT_QUOTA_BYTES,
      previewMaxBytes: c.PREVIEW_MAX_BYTES,
      partSizeBytes: c.PART_SIZE_BYTES,
      signedUrlTtl: c.SIGNED_URL_TTL_SECONDS,
      uploadUrlTtl: c.UPLOAD_URL_TTL_SECONDS,
    }),
    sessionTtlMs: c.SESSION_TTL_DAYS * 24 * 3600 * 1000,
    rateLimitStore: c.RATE_LIMIT_STORE,
    upstash: Object.freeze({ url: c.UPSTASH_REDIS_REST_URL, token: c.UPSTASH_REDIS_REST_TOKEN }),
    cronSecret: c.CRON_SECRET,
    mailDriver: c.MAIL_DRIVER,
    cookieSecure: isProd || bool(source.COOKIE_SECURE),
  });
}
