// Journalisation structurée (JSON, une ligne par événement). On n'y met jamais de secret, de jeton,
// d'URL signée, de mot de passe ni de contenu de fichier. Les clés suspectes sont masquées par sécurité.

const SENSITIVE = /pass|token|secret|authorization|cookie|signature|key|url/i;

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE.test(k)) out[k] = '[masqué]';
    else if (typeof v === 'string') out[k] = v.slice(0, 300);
    else out[k] = v;
  }
  return out;
}

export function createLogger({ silent = false } = {}) {
  const write = (level, event, fields) => {
    if (silent) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...redact(fields) });
    (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}
