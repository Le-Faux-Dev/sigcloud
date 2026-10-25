import { notImplemented } from './errors.js';

// Aucun fournisseur d'e-mail n'est branché dans le MVP.
//  - none (défaut)   : les fonctions qui exigent un e-mail répondent clairement « non configuré ».
//  - dev-outbox      : développement/tests uniquement, les messages restent en mémoire (jamais écrits dans les logs).

export function createMailer(config) {
  const outbox = [];
  return {
    enabled: config.mailDriver !== 'none',
    outbox,
    async send(message) {
      if (config.mailDriver === 'none') {
        throw notImplemented('MAIL_NOT_CONFIGURED', "L'envoi d'e-mails n'est pas configuré sur ce serveur.");
      }
      outbox.push({ ...message, at: new Date().toISOString() });
      if (outbox.length > 50) outbox.shift();
    },
  };
}
