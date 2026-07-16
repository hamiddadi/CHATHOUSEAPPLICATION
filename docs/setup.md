# Native setup guide

ChatHouse is a bare React Native application. Expo Go, Expo prebuild and EAS are
not part of the build pipeline.

## 1. Toolchains

- Node.js `>=22.20.0 <23`
- npm (the committed lockfiles are authoritative)
- Docker Desktop
- Android Studio, JDK 17 and Android SDK 36
- For iOS: macOS, Xcode, Ruby/Bundler and CocoaPods

## 2. Dependencies and environment

```bash
npm ci
cd backend && npm ci
```

Create the untracked environment files:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

Typical device-development values are:

```dotenv
API_BASE_URL=http://192.168.1.42:4000/api
WS_BASE_URL=ws://192.168.1.42:4000
LIVEKIT_URL=ws://192.168.1.42:7880
REALTIME_ENABLED=true
ENV=development
```

Use the computer's actual LAN address. Android Emulator may use `10.0.2.2`;
iOS Simulator may use `localhost`. Production is guarded and accepts only
HTTPS/WSS non-local endpoints.

## 3. Firebase

Download the two app configurations for bundle/package
`com.chathouse.app` and place them at:

- `android/app/google-services.json`
- `ios/ChatHouse/GoogleService-Info.plist`

The repository contains `.example` placeholders for CI compilation. They are
not functional Firebase credentials.

For CI, provide the real files as base64 secrets named
`FIREBASE_ANDROID_CONFIG_BASE64` and `FIREBASE_IOS_CONFIG_BASE64`.

## 4. Backend development stack

```bash
npm run backend:up
cd backend
npm run prisma:deploy
npm run dev
```

The normal development stack uses PostgreSQL on port 5433 and Redis on 6379.
The API listens on 4000.

## 5. Android

```bash
npm start
npm run android
```

Set `GOOGLE_MAPS_API_KEY` in the environment or user Gradle properties. For a
faster local native build, use one ABI:

```bash
cd android
./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
```

## 6. iOS

On macOS:

```bash
bundle install
npm run ios:pods
npm start
npm run ios
```

Open `ios/ChatHouse.xcworkspace` (not the `.xcodeproj`) when using Xcode. Select
your Apple Development Team before running on a physical device. Push
notifications and microphone publishing require a real device.

## 7. Universal links

Both platforms accept `chathouse://` and HTTPS links on
`https://app.chathouse.com`. Native declarations alone are insufficient; host:

- `https://app.chathouse.com/.well-known/assetlinks.json` with the Android
  package and production signing SHA-256 fingerprint.
- `https://app.chathouse.com/.well-known/apple-app-site-association` with the
  Apple Team ID and `com.chathouse.app`.

Serve both over HTTPS without redirects and with `application/json` content.

## 8. Integration tests

Never run backend tests against the development database. Use:

```bash
cd backend
npm run test:local
npm run test:infra:down
```

This uses the disposable `chathouse_test` database on port 5434 and test Redis
on 6380. The test setup and migration wrapper both reject non-test database
names.
