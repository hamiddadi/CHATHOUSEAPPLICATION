import * as ExpoConstants from 'expo-constants';

const Constants = ExpoConstants.default;

type Env = {
  API_BASE_URL: string;
  WS_BASE_URL: string;
  REALTIME_ENABLED: boolean;
  ENV: 'development' | 'staging' | 'production';
  SENTRY_DSN?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Env>;

export const env: Env = {
  API_BASE_URL: extra.API_BASE_URL ?? 'http://localhost:4000/api',
  WS_BASE_URL: extra.WS_BASE_URL ?? 'ws://localhost:4000',
  REALTIME_ENABLED: extra.REALTIME_ENABLED ?? false,
  ENV: (extra.ENV as Env['ENV']) ?? 'development',
  SENTRY_DSN: extra.SENTRY_DSN,
};

export const isDev = env.ENV === 'development';
export const isProd = env.ENV === 'production';
