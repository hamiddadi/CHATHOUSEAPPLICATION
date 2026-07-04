/**
 * Room-level shared constants.
 *
 * Title bounds are used by BOTH CreateRoomScreen and TitleEditModal so
 * creation and editing always agree (the edit modal previously allowed 120
 * chars while creation capped at 80 — an edited title could then be rejected
 * by the backend's create-time validation on the next room).
 */
export const ROOM_TITLE_MIN = 3;
export const ROOM_TITLE_MAX = 80;
