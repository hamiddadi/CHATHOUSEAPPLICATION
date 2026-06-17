export const roomChannel = (roomId: string): string => `room:${roomId}`;
export const userChannel = (userId: string): string => `user:${userId}`;

/**
 * Every socket that opens the map auto-joins this channel, so presence and
 * live mic/room-audio updates (`maps:user-moved`, `maps:user-offline`,
 * `map:user_update`) fan out to all viewers. Single-sourced here so the maps
 * handler and the realtime side-channel can't drift.
 */
export const MAPS_CHANNEL = 'maps:presence';
