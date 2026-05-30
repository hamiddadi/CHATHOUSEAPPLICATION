# Socket.io Events Reference

Source of truth : `backend/src/socket/realtime.ts` (legacy) and
`backend/src/socket/handlers/*.ts` (room/chat/hallway/rtc/maps).

## Connection channels

| Channel         | Members                                                  |
| --------------- | -------------------------------------------------------- |
| `hallway`       | Every authenticated client (broadcast room list changes) |
| `room:<roomId>` | Every participant of that room                           |
| `user:<userId>` | Direct channel to one user (notifications, badge)        |

## Hallway events (server → client)

| Event                  | Payload                                                          | Trigger                       |
| ---------------------- | ---------------------------------------------------------------- | ----------------------------- |
| `hallway:room_created` | `{ id, title, hostId, clubId, isLive, scheduledFor, createdAt }` | New room goes live            |
| `hallway:room_closed`  | `{ roomId }`                                                     | Host ends or last user leaves |
| `hallway:room_updated` | `{ roomId, participantCount?, title? }`                          | Title edited or count changed |

## Room events (server → client)

| Event               | Payload                                             | Trigger                        |
| ------------------- | --------------------------------------------------- | ------------------------------ |
| `room:hand_raised`  | `{ roomId, user }`                                  | Listener raises hand           |
| `room:hand_lowered` | `{ roomId, userId }`                                | Listener lowers / host accepts |
| `room:role_changed` | `{ roomId, userId, role }`                          | LISTENER ↔ SPEAKER ↔ MODERATOR |
| `room:mute_changed` | `{ roomId, userId, isMuted, by? }`                  | Self or moderator mute toggle  |
| `room:user_kicked`  | `{ roomId, userId, banUntil }`                      | Host kicks a participant       |
| `room:meta_updated` | `{ roomId, title?, chatEnabled?, chatVisibility? }` | Settings update                |
| `room:reaction`     | `{ roomId, emoji, userId }`                         | Ephemeral float-up reaction    |
| `room:chat_message` | `{ roomId, id, userId, content, createdAt }`        | New chat line                  |

## Notification events (server → client)

| Event                 | Payload                                       |
| --------------------- | --------------------------------------------- |
| `notification:new`    | `{ id, type, title, body, data?, createdAt }` |
| `notification:count`  | `{ unread: number }`                          |
| `user:follower_count` | `{ userId, count }`                           |

## Authentication

Sockets must present a JWT in the `auth.token` field at connect time.
See `backend/src/socket/socket.middleware.ts`.

## Extension events

The Clubhouse-parity extensions reuse the existing events — they do **not**
introduce new socket channels or event names. Net-quality reports flow over
HTTP (`POST /api/ext/netquality/report`) so they don't bloat the socket
plane.
