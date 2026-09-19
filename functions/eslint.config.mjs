import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['lib/**', 'node_modules/**'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', __dirname: 'readonly', Buffer: 'readonly' } },
    rules: { 'no-unused-vars': 'off', 'no-undef': 'off' },
  },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      globals: { process: 'readonly', console: 'readonly', __dirname: 'readonly', Buffer: 'readonly' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },
];
