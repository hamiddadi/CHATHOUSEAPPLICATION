import { Router } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';

/**
 * Extensions health endpoint.
 *
 * Unauthenticated by design — mobile clients hit this before they have a
 * session to know whether the running backend has the extension layer
 * mounted. The legacy backend's notFoundHandler will return 404 here,
 * which the mobile probe interprets as "extensions unavailable".
 *
 * The list of mounted vagues is hardcoded so it stays accurate without
 * having to scan the Express router stack at runtime.
 */

const VAGUES = [
  'v1-suggestions',
  'v1-contacts',
  'v1-presence',
  'v1-topics',
  'v2-events-cancel',
  'v2-chatmod',
  'v2-reminder-15',
  'v3-privacy',
  'v3-search-rooms',
  'v3-follow-fanout',
  'v4-audio',
  'v4-netquality',
  'v5-clubreq',
  'v7-payments',
  'v7-captions',
  'v7-twitter',
  'v8-calendar',
  'v8-share',
  'v8-speak-invite',
  'v8-socket-aliases',
  'v12-hide-room',
  'v12-notif-prefs',
  'v13-chat-reactions',
  'v13-recently-played',
  'v13-room-settings',
  'v13-badges',
  'v14-nominator',
  'v14-search-history',
  'v14-club-meta',
  'v14-profile-links',
];

export const healthRouter: Router = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({
      available: true,
      vaguesMounted: VAGUES,
      features: {
        payments: Boolean(process.env.STRIPE_SECRET_KEY),
        captions: Boolean(process.env.ASR_PROVIDER && process.env.ASR_API_KEY),
        twitter: Boolean(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET),
        contacts: Boolean(process.env.CONTACTS_HASH_SALT),
      },
    });
  }),
);
