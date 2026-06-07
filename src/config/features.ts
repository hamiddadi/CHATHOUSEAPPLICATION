/**
 * Build-time feature flags for surfaces that are temporarily hidden from the
 * UI. Flip a value to `true` to re-enable — nothing else needs to change.
 *
 * Hidden 2026-06-07 ("pour le moment"):
 * - roomRecording — the "enable recording" toggle on Create Room + the in-room
 *   "REC" badge. While off, new rooms are always created with recording off
 *   (the toggle is not rendered, so its state stays false).
 * - replays — the Replays feed. While off, the rooms-list header entry is not
 *   rendered and the screen is not registered in the navigator.
 */
export const FEATURES = {
  roomRecording: false,
  replays: false,
} as const;
