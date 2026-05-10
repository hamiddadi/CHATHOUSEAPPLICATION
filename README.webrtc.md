# Enabling real WebRTC audio (mediasoup-client + react-native-webrtc)

The app ships with a WebRTC audio skeleton in
[`src/features/rooms/services/roomAudioService.ts`](src/features/rooms/services/roomAudioService.ts)
and a hook [`src/features/rooms/hooks/useRoomAudio.ts`](src/features/rooms/hooks/useRoomAudio.ts)
that degrade gracefully (`status: 'unsupported'`) when the native deps aren't present.
All backend plumbing (mediasoup SFU, `rtc:*` socket events, STUN/TURN via coturn)
is already live — the only work left is on the client.

> ⚠️ This switches the project from **Expo Go** to a **custom dev client**.
> You can't go back easily. Do it on a branch first.

## 1. Install the native deps

```bash
npm install mediasoup-client react-native-webrtc
npm install --save-dev @config-plugins/react-native-webrtc
```

## 2. Register the config plugin in `app.json`

Add `@config-plugins/react-native-webrtc` before the rest:

```json
"plugins": [
  "@config-plugins/react-native-webrtc",
  "expo-font",
  "expo-secure-store",
  …
]
```

## 3. Prebuild + run on a device

```bash
npx expo prebuild              # generates ios/ and android/ folders
npx expo run:ios               # or run:android — NOT `start`
```

The first run compiles native code and can take 5-15 min. Subsequent reloads
go through Metro like normal.

## 4. Activate the skeleton

In
[`src/features/rooms/services/roomAudioService.ts`](src/features/rooms/services/roomAudioService.ts),
uncomment the 4 blocks marked with `// const device: Device = new Device();`
etc. The TypeScript `any` shims disappear once the packages are installed.

Then wire the hook in [`RoomScreen.tsx`](src/features/rooms/screens/RoomScreen/RoomScreen.tsx):

```tsx
import { useRoomAudio } from '../hooks/useRoomAudio';

const { status, setMuted } = useRoomAudio({ roomId: room.id, enabled: joined });
// Bind to the existing Mute/Unmute button:
<Pressable onPress={() => { setIsMuted(v => !v); void setMuted(!isMuted); }} ...>
```

## 5. Backend side (already done)

The SFU is running in Docker (`mediasoup ready with 1 worker(s)` at boot).
Phase 6 wired the full producer fan-out contract and Phase 5 added ICE
servers. For a real multi-peer test on different networks, enable the
coturn profile:

```bash
cd backend
docker compose --profile turn up -d coturn
# Then set on the api service env:
# ICE_SERVERS_JSON='[{"urls":"stun:127.0.0.1:3478"},{"urls":"turn:127.0.0.1:3478","username":"chathouse","credential":"chathouse"}]'
```

## 6. Test flow

1. Two devices join the same room (REST `/rooms/:id/join`)
2. Both open the room screen → `rtc:get-rtp-capabilities` → SFU returns caps + iceServers
3. Both create send + recv transports
4. Both produce audio → server broadcasts `rtc:new-producer` to the other
5. Both consume the peer's producer → audio plays via `react-native-webrtc`

If audio doesn't come through, check:

- Microphone permission granted (iOS `NSMicrophoneUsageDescription` + Android `RECORD_AUDIO`, both in `app.json`)
- `MEDIASOUP_ANNOUNCED_IP` in `backend/docker-compose.yml` set to your LAN IP (not `127.0.0.1`) when testing from phones
- UDP ports `40000-40019` reachable from the phone (`nc -zv <ip> 40000`)
- Socket.IO connection established (look for `socket connected user=…` in api logs)
