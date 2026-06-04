# features/rooms

Audio room experience — the core surface of the app.

## Screens

- `RoomFeedScreen` — hall feed (live + upcoming rooms)
- `CreateRoomScreen` — Open/Social/Private + scheduling
- `RoomScreen` — in-room UI (Stage + Listeners + Chat + Controls)
- `InviteToRoomScreen` — DM invite flow

## Components

`RoomChatSidebar`, `RoomControlsSheet`, `HostActionsSheet`, `ProfileActionSheet`, `SocketStatusBanner`, ...

## Hooks

- `useRoomAudio` — Agora / mediasoup audio handle
- `useHallwaySocket` — hallway feed live updates

## Services

- `roomService.ts` — REST endpoints (join, leave, RSVP, kick…)
- `roomAudioService.ts` — Audio engine glue
- `socketRoom.ts` — Room-scoped socket handlers

## Related extensions

- `src/features/extensions/components/ExtUpcomingForYouStrip` (Vague 3)
- `src/features/extensions/api/audioApi` (Vague 4 — quality tiers)
- `src/features/extensions/api/netqualityApi` (Vague 4 — bars)
