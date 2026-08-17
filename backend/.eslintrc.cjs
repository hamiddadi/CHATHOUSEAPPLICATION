/**
 * Backend-local ESLint configuration.
 *
 * CI installs the backend as an independent package. Keep this configuration
 * limited to plugins declared in backend/package.json so a clean backend
 * checkout never relies on the React Native package's node_modules.
 */
module.exports = {
  root: true,
  extends: ['plugin:@typescript-eslint/recommended', 'plugin:security/recommended-legacy'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'security'],
  env: {
    es2022: true,
    jest: true,
    node: true,
  },
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    '@typescript-eslint/no-non-null-assertion': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'security/detect-object-injection': 'off',
    'security/detect-non-literal-require': 'off',
  },
  overrides: [
    {
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
  ignorePatterns: ['coverage/', 'dist/', 'node_modules/'],
};
