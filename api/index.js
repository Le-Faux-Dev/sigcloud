import { loadConfig } from '../server/src/config/env.js';
import { createApp } from '../server/src/app.js';

// Point d'entrée Vercel (fonction serverless). L'application Express est exportée comme gestionnaire.
// Aucun état en mémoire entre requêtes : sessions, limitation de débit et données sont en base ou dans des stores externes.
const config = loadConfig();
const { app } = createApp({ config });

export default app;
