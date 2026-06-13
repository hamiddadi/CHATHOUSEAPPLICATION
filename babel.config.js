module.exports = function (api) {
  api.cache(true);
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
      // Worklets plugin MUST be last (replaces `react-native-reanimated/plugin` in Reanimated v4).
      'react-native-worklets/plugin',
    ],
  };
};
