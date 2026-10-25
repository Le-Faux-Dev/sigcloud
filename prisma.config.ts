import { defineConfig } from "prisma/config";

// Prisma 7 ne lit plus le fichier .env tout seul : on le charge ici (Node 22+). Les variables déjà définies dans
// l'environnement (Vercel, CI) gardent la priorité.
try {
  process.loadEnvFile(".env");
} catch {
  /* pas de .env : on utilise l'environnement du système */
}

// Migrations : utiliser l'URL DIRECTE de Neon (DIRECT_URL), pas l'URL poolée.
// L'application, elle, utilise DATABASE_URL (URL poolée) via l'adaptateur pg (voir server/src/db.js).
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL ou DATABASE_URL manquant : renseigne-le dans .env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
