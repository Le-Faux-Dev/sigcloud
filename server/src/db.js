import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Crée le client Prisma (adaptateur `pg`, sans moteur binaire).
 * En production sur Vercel, DATABASE_URL doit être l'URL POOLÉE de Neon.
 * @param {{databaseUrl: string, dbPoolMax: number}} config
 */
export function createDb(config) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  prisma.$closePool = () => pool.end();
  return prisma;
}
