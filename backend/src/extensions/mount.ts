import type { Express } from 'express';
import { logger } from '../config/logger';
import { audioRouter } from './modules/audio/audio.router';
import { badgesRouter } from './modules/badges/badges.router';
import { calendarRouter } from './modules/calendar/calendar.router';
import { captionsRouter } from './modules/captions/captions.router';
import { chatmodRouter } from './modules/chatmod/chatmod.router';
import { chatReactionsRouter } from './modules/chatReactions/chatReactions.router';
import { clubMetaRouter } from './modules/clubMeta/clubMeta.router';
import { clubReqRouter } from './modules/clubreq/clubreq.router';
import { contactsRouter } from './modules/contacts/contacts.router';
import { eventsRouter } from './modules/events/events.router';
import { healthRouter as extHealthRouter } from './modules/health/health.router';
import { hideRoomRouter } from './modules/hideRoom/hideRoom.router';
import { invitesRouter } from './modules/invites/invites.router';
import { netqualityRouter } from './modules/netquality/netquality.router';
import { nominatorRouter } from './modules/nominator/nominator.router';
import { notifPrefsExtRouter } from './modules/notifPrefsExt/notifPrefsExt.router';
import { paymentsRouter } from './modules/payments/payments.router';
import { premiumRouter } from './modules/premium/premium.router';
import { presenceRouter } from './modules/presence/presence.router';
import { privacyRouter } from './modules/privacy/privacy.router';
import { profileLinksRouter } from './modules/profileLinks/profileLinks.router';
import { recentlyPlayedRouter } from './modules/recentlyPlayed/recentlyPlayed.router';
import { roomSettingsExtRouter } from './modules/roomSettingsExt/roomSettingsExt.router';
import { searchExtRouter } from './modules/searchext/searchext.router';
import { searchHistoryRouter } from './modules/searchHistory/searchHistory.router';
import { shareRouter } from './modules/share/share.router';
import { speakInviteRouter } from './modules/speakInvite/speakInvite.router';
import { suggestionsRouter } from './modules/suggestions/suggestions.router';
import { topicsRouter } from './modules/topics/topics.router';
import { twitterRouter } from './modules/twitter/twitter.router';
import { shutdownFollowFanout, startFollowFanoutWorker } from './queues/followFanout';
import { shutdownReminder15, startReminder15Worker } from './queues/reminder15';

const mountedApps = new WeakSet<Express>();

/**
 * Mount extension routers before the terminal 404/error middleware.
 * createApp() owns that ordering; this function is intentionally idempotent
 * and never mutates Express's private router stack.
 */
export const mountExtensions = (app: Express): void => {
  if (mountedApps.has(app)) return;
  mountedApps.add(app);

  app.use('/api/ext/suggestions', suggestionsRouter);
  app.use('/api/ext/contacts', contactsRouter);
  app.use('/api/ext/presence', presenceRouter);
  app.use('/api/ext/topics', topicsRouter);
  app.use('/api/ext/events', eventsRouter);
  app.use('/api/ext/chatmod', chatmodRouter);
  app.use('/api/ext/privacy', privacyRouter);
  app.use('/api/ext/search', searchExtRouter);
  app.use('/api/ext/audio', audioRouter);
  app.use('/api/ext/netquality', netqualityRouter);
  app.use('/api/ext/clubreq', clubReqRouter);
  app.use('/api/ext/payments', paymentsRouter);
  app.use('/api/ext/premium', premiumRouter);
  app.use('/api/ext/captions', captionsRouter);
  app.use('/api/ext/twitter', twitterRouter);
  app.use('/api/ext/calendar', calendarRouter);
  app.use('/api/ext/share', shareRouter);
  app.use('/api/ext/speak-invite', speakInviteRouter);
  app.use('/api/ext/hide-room', hideRoomRouter);
  app.use('/api/ext/notif-prefs', notifPrefsExtRouter);
  app.use('/api/ext/chat-reactions', chatReactionsRouter);
  app.use('/api/ext/recently-played', recentlyPlayedRouter);
  app.use('/api/ext/room-settings', roomSettingsExtRouter);
  app.use('/api/ext/badges', badgesRouter);
  app.use('/api/ext/nominator', nominatorRouter);
  app.use('/api/ext/search-history', searchHistoryRouter);
  app.use('/api/ext/club-meta', clubMetaRouter);
  app.use('/api/ext/profile-links', profileLinksRouter);
  app.use('/api/ext/invites', invitesRouter);
  app.use('/api/ext/health', extHealthRouter);

  logger.info('extensions mounted: v1..v17 (+ unauth health probe at /api/ext/health)');
};

/**
 * Extension workers are process-scoped, not Express-app-scoped. Keeping them
 * out of createApp() makes tests and tooling deterministic.
 */
export const startExtensionWorkers = (): void => {
  startReminder15Worker();
  startFollowFanoutWorker();
};

export const shutdownExtensionWorkers = async (): Promise<void> => {
  shutdownFollowFanout();
  await shutdownReminder15();
};
