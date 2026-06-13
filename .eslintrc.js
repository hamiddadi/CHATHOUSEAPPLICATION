/**
 * ESLint configuration — central source of truth for all lint rules.
 * Per project policy, NO inline eslint-disable comments in src/.
 * File-specific exceptions live in the `overrides` section below.
 */
module.exports = {
  root: true,
  extends: [
    'expo',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react-native/all',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:security/recommended-legacy',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-native', 'import', 'security', 'prettier'],
  env: {
    'react-native/react-native': true,
    jest: true,
  },
  settings: {
    'import/resolver': {
      typescript: { project: './tsconfig.json' },
      node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] },
    },
    // `@env` is a virtual module provided by react-native-dotenv at babel time
    // (de-Expo migration). It has no file on disk, so tell eslint-plugin-import
    // it is always resolvable — otherwise import/no-unresolved flags it.
    'import/core-modules': ['@env'],
    react: { version: 'detect' },
  },
  rules: {
    // ---- Formatting (Prettier) ----
    'prettier/prettier': 'warn',

    // ---- TypeScript hygiene ----
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
    '@typescript-eslint/no-non-null-assertion': 'warn',

    // ---- React / React Native ----
    'react/react-in-jsx-scope': 'off',
    'react-native/no-raw-text': 'off',
    'react-native/no-color-literals': 'off',
    'react-native/sort-styles': 'off',
    'react-native/no-inline-styles': 'warn',
    'react-native/no-unused-styles': 'warn',

    // ---- Imports hygiene ----
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'never',
      },
    ],
    'import/no-duplicates': 'warn',
    'import/no-cycle': ['error', { maxDepth: 2 }],
    'import/no-useless-path-segments': 'warn',

    // ---- Console discipline ----
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],

    // ---- Security (eslint-plugin-security) — tune signal/noise ----
    'security/detect-object-injection': 'off', // too noisy on record lookups
    'security/detect-non-literal-require': 'off', // metro handles RN requires
  },
  overrides: [
    {
      // React Navigation module augmentation pattern requires `namespace` + empty interface.
      files: ['src/core/navigation/types.ts'],
      rules: {
        '@typescript-eslint/no-namespace': 'off',
        '@typescript-eslint/no-empty-object-type': 'off',
      },
    },
    {
      // Tab bar icon factories intentionally return unnamed components.
      files: ['src/core/navigation/**/*Navigator.tsx'],
      rules: {
        'react/display-name': 'off',
      },
    },
    {
      // Test files — relaxed rules.
      files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        'import/no-named-as-default-member': 'off',
        'react-native/no-inline-styles': 'off',
      },
    },
    {
      // Config / mocks — no TS strict checks.
      files: ['**/*.config.js', '**/*.config.ts', '**/mocks/**'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
    {
      // CLI scripts — console output is the primary user interface.
      files: ['**/scripts/**'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
  ignorePatterns: [
    'dist/',
    'node_modules/',
    '.expo/',
    'android/',
    'ios/',
    'coverage/',
    '*.config.js',
    'metro.config.js',
    'babel.config.js',
    'tailwind.config.js',
    'jest.config.js',
    'nativewind-env.d.ts',
  ],
};
