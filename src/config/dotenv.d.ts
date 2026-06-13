/**
 * Type declarations for the virtual `@env` module provided by
 * `react-native-dotenv` (de-Expo migration; replaces `expo-constants`).
 * Every value is `string | undefined` — react-native-dotenv is configured with
 * `allowUndefined: true`, so a key missing from `.env` resolves to `undefined`
 * and falls back to the zod default in `env.ts`.
 *
 * NB: named `dotenv.d.ts` (not `env.d.ts`) on purpose — a `.d.ts` sharing a
 * basename with a sibling `.ts` (env.ts) is treated by TS as that module's
 * declaration file and the ambient `declare module` is dropped from the program.
 */
declare module '@env' {
  export const API_BASE_URL: string | undefined;
  export const WS_BASE_URL: string | undefined;
  export const REALTIME_ENABLED: string | undefined;
  export const ENV: string | undefined;
  export const SENTRY_DSN: string | undefined;
  export const LIVEKIT_URL: string | undefined;
}
