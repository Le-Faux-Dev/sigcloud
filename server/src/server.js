import { loadConfig } from './config/env.js';
import { createApp } from './app.js';

// Démarrage local : `npm run dev` (charge .env avec --env-file). Sur Vercel, voir api/index.js.
const config = loadConfig();
const { app, ctx } = createApp({ config, serveClient: true });

const server = app.listen(config.port, () => {
  ctx.log.info('server_started', { port: config.port, env: config.env, storage: config.storage.driver });
});

const shutdown = async () => {
  server.close();
  await ctx.db.$disconnect();
  await ctx.db.$closePool?.();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
