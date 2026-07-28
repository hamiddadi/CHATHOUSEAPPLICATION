import { Router, type Response } from 'express';
import { env } from '../config/env';

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    character =>
      (
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }) as const
      )[character as '&' | '<' | '>' | '"' | "'"],
  );

const legalIdentity = {
  entity: escapeHtml(env.LEGAL_ENTITY_NAME ?? 'ChatHouse development operator'),
  address: escapeHtml(env.LEGAL_REGISTERED_ADDRESS ?? 'Not applicable outside production'),
  jurisdiction: escapeHtml(env.LEGAL_JURISDICTION ?? 'Not applicable outside production'),
  authority: escapeHtml(env.LEGAL_SUPERVISORY_AUTHORITY ?? 'Not applicable outside production'),
  transferSafeguards: escapeHtml(
    env.LEGAL_TRANSFER_SAFEGUARDS ?? 'Not applicable outside production',
  ),
  privacyEmail: escapeHtml(env.PRIVACY_CONTACT_EMAIL ?? 'privacy@chathouse.app'),
  supportEmail: escapeHtml(env.SUPPORT_CONTACT_EMAIL ?? 'support@chathouse.app'),
};

const appleTeamId = env.APPLE_TEAM_ID ?? 'TESTTEAMID';
const androidAppSigningSha256 =
  env.ANDROID_APP_SIGNING_SHA256 ??
  '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00';

const htmlHeaders = (res: Response): void => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

const layout = (title: string, body: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
  </head>
  <body>
    <header>
      <h1>${title}</h1>
      <p>ChatHouse · Last updated July 18, 2026</p>
    </header>
    <main>${body}</main>
    <footer>
      <p>${legalIdentity.entity} · ${legalIdentity.address}</p>
      <p>Privacy contact: ${legalIdentity.privacyEmail}</p>
    </footer>
  </body>
</html>`;

const privacyPolicy = layout(
  'ChatHouse Privacy Policy',
  `
    <section>
      <h2>Controller and contact</h2>
      <p>The data controller is ${legalIdentity.entity}, registered at
      ${legalIdentity.address}. This policy is governed by the laws of
      ${legalIdentity.jurisdiction}. Privacy enquiries can be sent to
      <a href="mailto:${legalIdentity.privacyEmail}">${legalIdentity.privacyEmail}</a>.</p>
    </section>
    <section>
      <h2>Data we process</h2>
      <p>We process account identifiers and profile data (including phone number,
      email when provided, username, display name, profile image, biography,
      interests and social links); social relationships; rooms and participation;
      direct, group, room-chat and voice messages; houses; reports and moderation
      records; notification tokens and preferences; payment and subscription
      history; Explore search queries and account-linked search history; and
      security metadata such as IP address, user agent and login timestamps.</p>
      <p>Precise location is optional, disabled by default, and sent only after
      the user enables map visibility. Other opted-in visible users may then see
      the user's location on the real-time map. Turning visibility off clears the
      stored coordinates. Stale coordinates are also purged automatically.</p>
      <p>Room recording and replay creation are disabled. Live room audio is
      transported for the conversation but is not recorded by ChatHouse. Voice
      messages deliberately created by a user are stored as private media.</p>
    </section>
    <section>
      <h2>Purposes and legal bases</h2>
      <p>We process data to provide and secure the service, authenticate accounts,
      deliver live audio and messages, show opted-in map users, process payments,
      personalize Explore results and recent searches, prevent abuse, moderate
      user-generated content, meet legal obligations and respond to privacy
      requests. Optional mobile crash reporting is disabled by default and starts
      only after explicit opt-in consent; consent can be withdrawn in Settings at
      any time.</p>
    </section>
    <section>
      <h2>Processors and transfers</h2>
      <p>Depending on enabled features, data is processed for us by infrastructure
      and private object-storage providers, Twilio (authentication SMS), Firebase
      and Apple Push Notification service (notifications), LiveKit (live audio),
      Stripe (payments), and Sentry (opt-in mobile diagnostics and restricted
      server reliability diagnostics). We do not sell personal data, use it for
      cross-app advertising, or share it with data brokers.</p>
      <p>Where a transfer leaves the applicable jurisdiction, the safeguards are:
      ${legalIdentity.transferSafeguards}.</p>
    </section>
    <section>
      <h2>Retention and deletion</h2>
      <p>Active-account content is retained while needed to provide the service.
      A self-service deletion request immediately disables the account, clears
      map location, revokes sessions and removes push tokens. The account remains
      in a 30-day recovery period. A successful sign-in during that period
      restores a self-deleted account; otherwise the database records and private
      media are permanently purged. Moderation bans cannot be self-restored.</p>
      <p>Expired authentication artefacts are removed on short schedules,
      security/audit logs are normally retained for 90 days, and a processor may
      retain narrowly required financial or legal records for the period imposed
      by law. Any such exception is isolated from normal product use.</p>
      <p><a href="/account-deletion">Request account and associated-data deletion</a>.</p>
    </section>
    <section>
      <h2>Your choices and rights</h2>
      <p>Users can edit their profile, disable location and notifications,
      withdraw crash-reporting consent, export a structured copy of their data,
      and request deletion in the app. Depending on local law, users may also
      request access, correction, restriction, objection, portability or
      erasure, and complain to their supervisory authority.</p>
      <p>The relevant supervisory authority is ${legalIdentity.authority}.</p>
    </section>
    <section>
      <h2>Children</h2>
      <p>ChatHouse is not intended for children under 16. Account creation
      requires a 16-or-over self-attestation and the server rejects registration
      without it.</p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>Email <a href="mailto:${legalIdentity.privacyEmail}">${legalIdentity.privacyEmail}</a>.
      Never send a password, OTP code, access
      token or payment-card number by email.</p>
    </section>
  `,
);

const accountDeletion = layout(
  'Delete a ChatHouse account',
  `
    <section id="account-deletion">
      <h2>Request account and associated-data deletion</h2>
      <p>You can submit the request in ChatHouse under Settings → Privacy →
      Delete my account. If the app is no longer installed or accessible, email
      <a href="mailto:${legalIdentity.privacyEmail}?subject=ChatHouse%20account%20deletion%20request">${legalIdentity.privacyEmail}</a>
      with the subject “ChatHouse account deletion request”. Include the
      username and the phone number or email associated with the account so
      support can verify ownership.</p>
      <p>Do not include a password, OTP code, session token or payment-card
      details. Support may ask you to prove control of the registered phone
      number or email before actioning the request.</p>
      <p>The request immediately disables the profile, location visibility,
      sessions and notifications, and schedules any recurring Stripe
      subscription not to renew. ChatHouse applies a 30-day recovery period;
      signing in successfully during those 30 days restores a self-deleted
      account and attempts to resume a cancellation that is still pending. If
      no restoration occurs, account data and private media are permanently
      purged. Narrow records may be retained only where required for security,
      fraud prevention or law, as described in the privacy policy.</p>
      <p>Customer-service deletion request:
      <a href="mailto:${legalIdentity.privacyEmail}?subject=ChatHouse%20account%20deletion%20request">email ${legalIdentity.privacyEmail}</a>.</p>
      <p><a href="/privacy">Read the ChatHouse Privacy Policy</a>.</p>
    </section>
  `,
);

const support = layout(
  'ChatHouse Support',
  `
    <section>
      <h2>Contact support</h2>
      <p>For account access, safety, technical or billing support, email
      <a href="mailto:${legalIdentity.supportEmail}">${legalIdentity.supportEmail}</a>.
      Do not send passwords, OTP codes, access tokens or full payment-card details.</p>
    </section>
    <section>
      <h2>Privacy and account deletion</h2>
      <p><a href="/privacy">Read the Privacy Policy</a>.</p>
      <p><a href="/account-deletion">Request account and associated-data deletion</a>.</p>
    </section>
  `,
);

export const legalRouter: Router = Router();

legalRouter.get('/privacy', (_req, res) => {
  htmlHeaders(res);
  res.status(200).send(privacyPolicy);
});

legalRouter.get('/account-deletion', (_req, res) => {
  htmlHeaders(res);
  res.status(200).send(accountDeletion);
});

legalRouter.get('/support', (_req, res) => {
  htmlHeaders(res);
  res.status(200).send(support);
});

legalRouter.get('/.well-known/assetlinks.json', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.chathouse.app',
        sha256_cert_fingerprints: [androidAppSigningSha256],
      },
    },
  ]);
});

legalRouter.get('/.well-known/apple-app-site-association', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${appleTeamId}.com.chathouse.app`,
          paths: ['*'],
        },
      ],
    },
  });
});
