// Lance les tests sur une VRAIE base PostgreSQL locale (jamais sur la production).
//  - Par défaut : démarre un PostgreSQL embarqué (paquet « embedded-postgres ») dans un dossier temporaire,
//    applique les migrations SQL du dépôt, lance les tests, puis arrête et supprime tout.
//  - Variante : TEST_DATABASE_URL=postgresql://.../sigcloud_test (le nom de la base DOIT contenir « test »),
//    par exemple pour utiliser un PostgreSQL déjà installé. Les tables y sont recréées à chaque exécution.
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(fileURLToPath(import.meta.url), '../..');
const args = process.argv.slice(2);

async function applyMigrations(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const dirs = (await readdir(join(root, 'prisma/migrations'), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const d of dirs) await client.query(await readFile(join(root, 'prisma/migrations', d, 'migration.sql'), 'utf8'));
  await client.end();
  return dirs.length;
}

function runNodeTests(databaseUrl) {
  const files = args.length ? args : ['server/tests/**/*.test.js'];
  return new Promise((res) => {
    const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        APP_SECRET: 'test-secret-test-secret-test-secret-123456',
      },
    });
    child.on('exit', (code) => res(code ?? 1));
  });
}

let embedded;
let dataDir;
let exitCode = 1;
try {
  let url = process.env.TEST_DATABASE_URL;
  if (url) {
    const dbName = new URL(url).pathname.slice(1);
    if (!/test/i.test(dbName)) throw new Error(`Par sécurité, TEST_DATABASE_URL doit viser une base dont le nom contient « test » (reçu : « ${dbName} »).`);
  } else {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    dataDir = await mkdtemp(join(tmpdir(), 'sigcloud-pg-'));
    await chmod(dataDir, 0o777); // le serveur PostgreSQL ne tourne jamais en root : il doit pouvoir écrire ici
    const port = 54000 + Math.floor(Math.random() * 900);
    embedded = new EmbeddedPostgres({ databaseDir: join(dataDir, 'data'), user: 'sigtest', password: 'sigtest', port, persistent: false, onLog: () => {}, onError: () => {} });
    await embedded.initialise();
    await embedded.start();
    await embedded.createDatabase('sigcloud_test');
    url = `postgresql://sigtest:sigtest@localhost:${port}/sigcloud_test`;
  }
  const n = await applyMigrations(url);
  console.log(`Base de test prête (${n} migration(s) appliquée(s)).`);
  exitCode = await runNodeTests(url);
} catch (err) {
  console.error(`Impossible de préparer la base de test : ${err.message}`);
} finally {
  if (embedded) await embedded.stop().catch(() => {});
  if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
process.exit(exitCode);
