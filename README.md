# Chathouse

Audio social network (Clubhouse-like) built with Expo + React Native + TypeScript.

## Stack

- Expo SDK 52 (React Native 0.76)
- TypeScript strict
- React Navigation v7 (Native Stack + Bottom Tabs)
- Zustand (client state) + TanStack Query (server state)
- react-hook-form + Zod (forms + validation)
- expo-av / LiveKit (audio rooms, planned)
- expo-secure-store + AsyncStorage (persistence)
- StyleSheet with a typed design system in `src/shared/constants/theme.ts`

## Quick start

```bash
npm install
npx expo install --check   # align native module versions with the Expo SDK
npm run start
```

Open with Expo Go or an emulator (Android Studio / Xcode Simulator).

## Scripts

| Command             | What it does             |
| ------------------- | ------------------------ |
| `npm run start`     | Start the Metro bundler  |
| `npm run android`   | Build & run on Android   |
| `npm run ios`       | Build & run on iOS       |
| `npm run lint`      | ESLint check             |
| `npm run format`    | Prettier write           |
| `npm run typecheck` | TypeScript no-emit check |
| `npm test`          | Run Jest tests           |

## Architecture

Feature-based hybrid. See `src/` — each feature owns its `components/`, `screens/`, `hooks/`, `services/`, `store/`, `types/`.

```
src/
├── app/            # App root, navigation, providers
├── features/       # auth, rooms, houses, messages, maps, settings, profile, search, notifications, onboarding
├── shared/         # shared components, hooks, services, utils, constants (theme)
├── config/         # env + feature flags
└── assets/
```

## Design system

Material 3 dark palette extracted from the reference mocks (`src/ui/`). All tokens in `src/shared/constants/theme.ts` — never hand-pick colors.
