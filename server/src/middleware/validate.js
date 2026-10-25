import { badRequest } from '../lib/errors.js';

/**
 * Valide body / query / params avec zod. Les valeurs validées sont dans req.valid (jamais req.body brut).
 * Les schémas sont stricts : les champs inconnus sont refusés.
 */
export function validate({ body, query, params }) {
  return (req, _res, next) => {
    req.valid = {};
    const sources = [
      ['body', body, req.body ?? {}],
      ['query', query, req.query],
      ['params', params, req.params],
    ];
    for (const [name, schema, value] of sources) {
      if (!schema) continue;
      const result = schema.safeParse(value);
      if (!result.success) {
        const fields = result.error.issues.slice(0, 10).map((i) => ({ champ: i.path.join('.') || name, message: i.message }));
        return next(badRequest('VALIDATION_ERROR', 'Les données envoyées sont invalides.', { fields }));
      }
      req.valid[name] = result.data;
    }
    next();
  };
}
