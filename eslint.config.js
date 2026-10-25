import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'client/assets/**', '.data/**', 'reports/**'] },
  js.configs.recommended,
  {
    files: ['server/**/*.js', 'scripts/**/*.mjs', 'e2e/**/*.mjs', 'api/**/*.js', 'prisma/**/*.ts', '*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: ['client/scripts/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Sécurité : jamais de HTML construit par chaîne, jamais d'évaluation de code.
      'no-restricted-properties': ['error',
        { property: 'innerHTML', message: 'innerHTML interdit : utiliser h()/textContent.' },
        { property: 'outerHTML', message: 'outerHTML interdit.' },
        { property: 'insertAdjacentHTML', message: 'insertAdjacentHTML interdit.' },
        { object: 'document', property: 'write', message: 'document.write interdit.' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
];
