module.exports = {
  // de-Expo: was `jest-expo`. The bare React Native preset wires the RN module
  // mocks + babel transform (babel.config.js already uses @react-native/babel-preset).
  preset: 'react-native',
  // Screen render-test harness: mocks every native module + boots i18n so any
  // screen can mount under jest (no emulator). See jest-setup.ts.
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:jest-)?react-native|@react-native|@react-navigation|' +
      '@react-native-community|@react-native-vector-icons|@react-native-firebase|' +
      '@notifee|react-native-.*|zustand|@tanstack/react-query)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@features/(.*)$': '<rootDir>/src/features/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@assets/(.*)$': '<rootDir>/src/assets/$1',
    // react-native-localize ships a jest mock; use it so importing the device
    // locale (via i18n) doesn't hit the absent native module under jest.
    '^react-native-localize$': 'react-native-localize/mock',
  },
  roots: ['<rootDir>/src'],
  testPathIgnorePatterns: ['<rootDir>/backend/', '<rootDir>/node_modules/'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/**/index.ts'],
};
