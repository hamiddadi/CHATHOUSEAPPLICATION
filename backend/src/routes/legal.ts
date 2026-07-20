import { Router, type Response } from 'express';

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
      <p>Privacy contact: privacy@chathouse.app</p>
    </footer>
  </body>
</html>`;

const privacyPolicy = layout(
  'ChatHouse Privacy Policy',
  `
    <section>
      <h2>Data we process</h2>
      <p>We process account identifiers and profile data (including phone number,
      email when provided, username, display name, profile image, biography,
      interests and social links); social relationships; rooms and participation;
      direct, group, room-chat and voice messages; houses; reports and moderation
      records; notification tokens and preferences; payment and subscription
      history; and security metadata such as IP address, user agent and login
      timestamps.</p>
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
      prevent abuse, moderate user-generated content, meet legal obligations and
      respond to privacy requests. Optional mobile crash reporting is disabled by
      default and starts only after explicit opt-in consent; consent can be
      withdrawn in Settings at any time.</p>
    </section>
    <section>
      <h2>Processors and transfers</h2>
      <p>Depending on enabled features, data is processed for us by infrastructure
      and private object-storage providers, Twilio (authentication SMS), Firebase
      and Apple Push Notification service (notifications), LiveKit (live audio),
      Stripe (payments), and Sentry (opt-in mobile diagnostics and restricted
      server reliability diagnostics). We do not sell personal data, use it for
      cross-app advertising, or share it with data brokers.</p>
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
    </section>
    <section>
      <h2>Children</h2>
      <p>ChatHouse is not intended for children under 16. Account creation
      requires a 16-or-over self-attestation and the server rejects registration
      without it.</p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>Email privacy@chathouse.app. Never send a password, OTP code, access
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
      <a href="mailto:privacy@chathouse.app?subject=ChatHouse%20account%20deletion%20request">privacy@chathouse.app</a>
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
      <a href="mailto:privacy@chathouse.app?subject=ChatHouse%20account%20deletion%20request">email privacy@chathouse.app</a>.</p>
      <p><a href="/privacy">Read the ChatHouse Privacy Policy</a>.</p>
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
