// Promeut un compte EXISTANT en administrateur :  npm run create-admin -- prenom@exemple.com
// (Le compte doit d'abord être créé par l'inscription normale : ce script ne manipule jamais de mot de passe.)
import { loadConfig } from '../server/src/config/env.js';
import { createDb } from '../server/src/db.js';

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email.includes('@')) {
  console.error('Usage : npm run create-admin -- adresse@exemple.com');
  process.exit(1);
}
const config = loadConfig();
const db = createDb(config);
try {
  const res = await db.user.updateMany({ where: { email }, data: { role: 'ADMIN' } });
  if (res.count === 0) {
    console.error(`Aucun compte avec l'adresse ${email}. Crée-le d'abord via la page d'inscription.`);
    process.exitCode = 1;
  } else {
    console.log(`${email} est maintenant administrateur.`);
  }
} finally {
  await db.$disconnect();
  await db.$closePool?.();
}
