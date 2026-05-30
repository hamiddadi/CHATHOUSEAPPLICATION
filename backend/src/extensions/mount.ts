import type { Express } from 'express';
import { logger } from '../config/logger';
// Vague 1
import { suggestionsRouter } from './modules/suggestions/suggestions.router';
import { contactsRouter } from './modules/contacts/contacts.router';
import { presenceRouter } from './modules/presence/presence.router';
import { topicsRouter } from './modules/topics/topics.router';
// Vague 2
import { eventsRouter } from './modules/events/events.router';
import { chatmodRouter } from './modules/chatmod/chatmod.router';
import { startReminder15Worker } from './queues/reminder15';
// Vague 3
import { privacyRouter } from './modules/privacy/privacy.router';
import { searchExtRouter } from './modules/searchext/searchext.router';
import { startFollowFanoutWorker } from './queues/followFanout';
// Vague 4
import { audioRouter } from './modules/audio/audio.router';
import { netqualityRouter } from './modules/netquality/netquality.router';
// Vague 5
import { clubReqRouter } from './modules/clubreq/clubreq.router';
// Vague 7
import { paymentsRouter } from './modules/payments/payments.router';
import { captionsRouter } from './modules/captions/captions.router';
import { twitterRouter } from './modules/twitter/twitter.router';
// Vague 8
import { calendarRouter } from './modules/calendar/calendar.router';
import { shareRouter } from './modules/share/share.router';
import { speakInviteRouter } from './modules/speakInvite/speakInvite.router';
// Vague 12
import { hideRoomRouter } from './modules/hideRoom/hideRoom.router';
import { notifPrefsExtRouter } from './modules/notifPrefsExt/notifPrefsExt.router';
// Vague 13
import { chatReactionsRouter } from './modules/chatReactions/chatReactions.router';
import { recentlyPlayedRouter } from './modules/recentlyPlayed/recentlyPlayed.router';
import { roomSettingsExtRouter } from './modules/roomSettingsExt/roomSettingsExt.router';
import { badgesRouter } from './modules/badges/badges.router';
// Vague 14
import { nominatorRouter } from './modules/nominator/nominator.router';
import { searchHistoryRouter } from './modules/searchHistory/searchHistory.router';
import { clubMetaRouter } from './modules/clubMeta/clubMeta.router';
import { profileLinksRouter } from './modules/profileLinks/profileLinks.router';
// Vague 17
import { healthRouter as extHealthRouter } from './modules/health/health.router';

/**
 * Surgical re-insertion: `createApp()` already registered notFoundHandler
 * and errorMiddleware at the tail of the router stack. We pop them off,
 * mount our extension routers, then re-push the tail so the 404 fires
 * AFTER our routes get a chance.
 *
 * We rely on Express's `_router.stack` array — a stable internal API
 * across Express 4 and 5. The stack holds Layer objects with `name`
 * properties (defaulting to the handler function's name).
 */
const reorderTail = (app: Express, mountFn: () => void): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const router = app as unknown as { _router?: { stack: any[] }; router?: { stack: any[] } };
  const stack = router._router?.stack ?? router.router?.stack;
  if (!Array.isArray(stack)) {
    // Older/newer Express edge case — fall back to plain mount (extensions
    // will only work for paths the legacy 404 doesn't intercept).
    mountFn();
    return;
  }
  // The tail is the last two: notFoundHandler then errorMiddleware. We
  // identify them defensively by name (set by createApp's imports).
  const tail: unknown[] = [];
  while (stack.length > 0) {
    const last = stack[stack.length - 1];
    const handleName: string = last?.name || last?.handle?.name || '';
    if (handleName === 'notFoundHandler' || handleName === 'errorMiddleware') {
      tail.unshift(stack.pop());
      continue;
    }
    break;
  }
  // If we removed nothing, the name-based matching failed (minification,
  // handler wrapping/renaming, or an Express layout change). The ext routers
  // then get appended AFTER the legacy notFoundHandler and are shadowed by
  // the 404 — a silent prod regression. Surface it loudly rather than fail
  // open quietly.
  if (tail.length === 0) {
    logger.warn(
      'mount: tail handlers (notFoundHandler/errorMiddleware) not found — ' +
        'ext routes may be shadowed by the legacy 404',
    );
  }
  mountFn();
  for (const layer of tail) stack.push(layer);
};

export const mountExtensions = (app: Express): void => {
  reorderTail(app, () => mountAll(app));
};

const mountAll = (app: Express): void => {
  // Vague 1
  app.use('/api/ext/suggestions', suggestionsRouter);
  app.use('/api/ext/contacts', contactsRouter);
  app.use('/api/ext/presence', presenceRouter);
  app.use('/api/ext/topics', topicsRouter);
  // Vague 2
  app.use('/api/ext/events', eventsRouter);
  app.use('/api/ext/chatmod', chatmodRouter);
  startReminder15Worker();
  // Vague 3
  app.use('/api/ext/privacy', privacyRouter);
  app.use('/api/ext/search', searchExtRouter);
  startFollowFanoutWorker();
  // Vague 4
  app.use('/api/ext/audio', audioRouter);
  app.use('/api/ext/netquality', netqualityRouter);
  // Vague 5
  app.use('/api/ext/clubreq', clubReqRouter);
  // Vague 7 (feature-flagged via env)
  app.use('/api/ext/payments', paymentsRouter);
  app.use('/api/ext/captions', captionsRouter);
  app.use('/api/ext/twitter', twitterRouter);
  // Vague 8 (socket alias layer + calendar export + share + speak-invite)
  app.use('/api/ext/calendar', calendarRouter);
  app.use('/api/ext/share', shareRouter);
  app.use('/api/ext/speak-invite', speakInviteRouter);
  // Vague 12 (hide-room + extended notif prefs)
  app.use('/api/ext/hide-room', hideRoomRouter);
  app.use('/api/ext/notif-prefs', notifPrefsExtRouter);
  // Vague 13 (chat reactions, recent rooms, room settings ext, badges)
  app.use('/api/ext/chat-reactions', chatReactionsRouter);
  app.use('/api/ext/recently-played', recentlyPlayedRouter);
  app.use('/api/ext/room-settings', roomSettingsExtRouter);
  app.use('/api/ext/badges', badgesRouter);
  // Vague 14 (nominator, search history, club meta, profile links)
  app.use('/api/ext/nominator', nominatorRouter);
  app.use('/api/ext/search-history', searchHistoryRouter);
  app.use('/api/ext/club-meta', clubMetaRouter);
  app.use('/api/ext/profile-links', profileLinksRouter);
  // Vague 17 — unauthenticated health probe for the extension layer
  app.use('/api/ext/health', extHealthRouter);
  logger.info('extensions mounted: v1..v17 (+ unauth health probe at /api/ext/health)');
};
