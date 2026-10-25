import { createLocalStorage } from './local.js';
import { createR2Storage } from './r2.js';

/** Retourne le pilote de stockage configuré (local en dev/tests, r2 en production). */
export function createStorage(config) {
  return config.storage.driver === 'r2' ? createR2Storage(config) : createLocalStorage(config);
}
