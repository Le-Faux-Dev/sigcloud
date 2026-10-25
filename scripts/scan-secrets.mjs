// Recherche de secrets dans les fichiers du dépôt (alternative légère à Gitleaks, qui n'a pas pu être installé ici).
// Motifs : clés privées, clés d'accès cloud connues, URL de base avec mot de passe non fictif, jetons courants,
// affectations « secret = valeur longue ». Les valeurs FICTIVES de .env.example (CHANGE_ME, user:password…) sont tolérées.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.data', 'reports', '.vercel', 'vendor']);
const SKIP_EXT = /\.(png|jpe?g|gif|woff2?|ico|zip|svg)$/i;
const PATTERNS = [
  ['clé privée', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['clé AWS/R2 (AKIA…)', /\bAKIA[0-9A-Z]{16}\b/],
  ['jeton GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['jeton Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['clé Stripe live', /\b[sr]k_live_[A-Za-z0-9]{16,}\b/],
  ['jeton JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['URL de base avec mot de passe', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:(?!password\b|CHANGE_ME|sigtest\b|\$\{)[^\s@/]{4,}@/i],
  ['secret en dur', /\b(?:secret|token|api[_-]?key|password)\b\s*[:=]\s*['"][A-Za-z0-9+/_=-]{24,}['"]/i],
];
const hits = [];
let scanned = 0;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name)); continue; }
    if (SKIP_EXT.test(e.name)) continue;
    const p = join(dir, e.name);
    if ((await stat(p)).size > 2_000_000) continue;
    scanned += 1;
    const rel = relative(root, p);
    if (/^\.env(\.|$)/.test(e.name) && e.name !== '.env.example') hits.push(`${rel}: fichier d'environnement présent dans l'arbre (ne doit pas être livré)`);
    const lines = (await readFile(p, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (line.includes('secret-scan: ignore')) return; // valeur FICTIVE de test, revue manuellement
      for (const [name, re] of PATTERNS) if (re.test(line)) hits.push(`${rel}:${i + 1}: ${name}`);
    });
  }
}
await walk(root);
console.log(`Fichiers analysés : ${scanned}`);
if (hits.length) { console.log(hits.join('\n')); console.log(`${hits.length} détection(s) à examiner.`); process.exit(1); }
console.log('Aucune détection.');
