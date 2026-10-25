import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDb } from './db.js';
import { createStorage } from './storage/index.js';
import { createLogger } from './lib/logger.js';
import { createMailer } from './lib/mailer.js';
import { createRateLimiter } from './lib/rateLimit.js';
import { audit } from './lib/audit.js';
import { apiNoStore, rateLimit, securityHeaders, strictCors } from './middleware/security.js';
import { csrfProtection, loadSession } from './middleware/auth.js';
import { apiNotFound, errorHandler, requestId } from './middleware/errors.js';
import { createAuthService } from './services/auth.js';
import { createAccess } from './services/access.js';
import { createFilesService } from './services/files.js';
import { createFoldersService } from './services/folders.js';
import { createSharesService } from './services/shares.js';
import { createCleanupService } from './services/cleanup.js';
import { createAdminService } from './services/admin.js';
import { authRoutes } from './routes/auth.js';
import { fileRoutes } from './routes/files.js';
import { folderRoutes, trashRoutes } from './routes/folders.js';
import { shareRoutes, publicRoutes } from './routes/shares.js';
import { adminRoutes } from './routes/admin.js';
import { systemRoutes, localStorageRoutes } from './routes/system.js';

const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../client');

/**
 * Assemble l'application. Tout ce qui dépend de l'environnement (config, base, stockage) est injecté :
 * c'est ce qui permet de tester sur une vraie base locale sans toucher à la production.
 * @param {{config: any, db?: any, storage?: any, log?: any, serveClient?: boolean}} deps
 */
export function createApp({ config, db, storage, log, serveClient = false }) {
  const ctx = {
    config,
    log: log ?? createLogger({ silent: config.isTest }),
    db: db ?? createDb(config),
    storage: storage ?? createStorage(config),
    mailer: createMailer(config),
  };
  ctx.rateLimiter = createRateLimiter(config, ctx.db);
  ctx.audit = (req, event) => audit(ctx, req, event);
  ctx.auth = createAuthService(ctx);
  ctx.access = createAccess(ctx);
  ctx.files = createFilesService(ctx);
  ctx.folders = createFoldersService(ctx);
  ctx.shares = createSharesService(ctx);
  ctx.cleanup = createCleanupService(ctx);
  ctx.admin = createAdminService(ctx);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(requestId);
  app.use(securityHeaders(config));

  const api = express.Router();
  api.use(apiNoStore, strictCors(config));
  // Stockage local (dev/tests) : corps binaires, monté AVANT le parseur JSON.
  api.use('/_local-storage', localStorageRoutes(ctx));
  api.use(express.json({ limit: '100kb', strict: true }));
  // Limiteur global : pas avec le store postgres (une écriture en base par requête serait trop coûteuse) ;
  // les routes sensibles ont leurs propres limites dans tous les cas.
  if (config.rateLimitStore !== 'postgres') api.use(rateLimit(ctx, { name: 'api', limit: 600, windowSeconds: 60 }));
  api.use(loadSession(ctx), csrfProtection(ctx));

  api.use('/auth', authRoutes(ctx));
  api.use('/files', fileRoutes(ctx));
  api.use('/folders', folderRoutes(ctx));
  api.use('/trash', trashRoutes(ctx));
  api.use('/shares', shareRoutes(ctx));
  api.use('/public', publicRoutes(ctx));
  api.use('/admin', adminRoutes(ctx));
  api.use('/', systemRoutes(ctx));
  api.use(apiNotFound);

  app.use('/api/v1', api);
  app.use('/api', apiNotFound);

  if (serveClient) {
    // Développement / démarrage local : le front statique est servi par Express.
    // Sur Vercel, ce sont les fichiers statiques de client/ qui sont servis (voir vercel.json).
    app.use(express.static(clientDir, { index: 'index.html', extensions: ['html'], dotfiles: 'ignore', maxAge: config.isProd ? '1h' : 0 }));
    app.use((_req, res) => res.status(404).sendFile(resolve(clientDir, '404.html')));
  }

  app.use(errorHandler(ctx));
  return { app, ctx };
}
