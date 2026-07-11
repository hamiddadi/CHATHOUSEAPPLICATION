module.exports = function (api) {
  // Cache the compiled config, but key the cache on ENVFILE so a release bundle
  // built with `ENVFILE=.env.production` never reuses the cached dev (.env) config.
  api.cache.using(() => process.env.ENVFILE || 'default');
  // File react-native-dotenv inlines for `@env`. Default `.env` (dev, unchanged);
  // a release build sets ENVFILE=.env.production to inline the public prod hosts.
  const envPath = process.env.ENVFILE || '.env';
  return {
    presets: [
      ['module:@react-native/babel-preset', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          extensions: [
            '.ios.ts',
            '.android.ts',
            '.ts',
            '.ios.tsx',
            '.android.tsx',
            '.tsx',
            '.js',
            '.jsx',
            '.json',
          ],
          alias: {
            '@': './src',
            '@core': './src/core',
            '@features': './src/features',
            '@shared': './src/shared',
            '@config': './src/config',
            '@assets': './src/assets',
          },
        },
      ],
      // Inline `import { X } from '@env'` from the root .env at bundle time
      // (de-Expo: replaces expo-constants `Constants.expoConfig.extra`).
      [
        'module:react-native-dotenv',
        {
          moduleName: '@env',
          path: envPath,
          allowUndefined: true,
          safe: false,
        },
      ],
      // Worklets plugin MUST be last (replaces `react-native-reanimated/plugin` in Reanimated v4).
      'react-native-worklets/plugin',
    ],
  };
};
