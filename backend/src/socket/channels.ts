export const roomChannel = (roomId: string): string => `room:${roomId}`;
export const userChannel = (userId: string): string => `user:${userId}`;

// Server-owned authorization channels. No client handler accepts arbitrary
// room names, so these can only be joined from the authenticated handshake.
// Keeping the actor and the exact delegated jti separate lets a global actor
// revocation close every impersonation session while "stop impersonating"
// closes only the bearer handed back by that browser/device.
export const delegatedActorChannel = (actorId: string): string => `auth:delegated-actor:${actorId}`;
export const delegatedTokenChannel = (jti: string): string => `auth:delegated-token:${jti}`;

/**
 * Every socket that opens the map auto-joins this channel, so presence and
 * live mic/room-audio updates (`maps:user-moved`, `maps:user-offline`,
 * `map:user_update`) fan out to all viewers. Single-sourced here so the maps
 * handler and the realtime side-channel can't drift.
 */
export const MAPS_CHANNEL = 'maps:presence';
