import { Router, type Request, type Response } from 'express';
import { env } from '../config/env';
import {
  LEGAL_DOCUMENT_FALLBACK_EFFECTIVE_DATE,
  LEGAL_DOCUMENT_FALLBACK_VERSION,
} from './legalDocumentMetadata';

type LegalLanguage = 'en' | 'fr';

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
  registrationNumber: escapeHtml(
    env.LEGAL_REGISTRATION_NUMBER ?? 'Not applicable outside production',
  ),
  jurisdiction: escapeHtml(env.LEGAL_JURISDICTION ?? 'Not applicable outside production'),
  disputeProcess: escapeHtml(env.LEGAL_DISPUTE_PROCESS ?? 'Not applicable outside production'),
  liabilityTerms: escapeHtml(env.LEGAL_LIABILITY_TERMS ?? 'Not applicable outside production'),
  authority: escapeHtml(env.LEGAL_SUPERVISORY_AUTHORITY ?? 'Not applicable outside production'),
  transferSafeguards: escapeHtml(
    env.LEGAL_TRANSFER_SAFEGUARDS ?? 'Not applicable outside production',
  ),
  documentVersion: escapeHtml(env.LEGAL_DOCUMENT_VERSION ?? LEGAL_DOCUMENT_FALLBACK_VERSION),
  effectiveDate: escapeHtml(
    env.LEGAL_DOCUMENT_EFFECTIVE_DATE ?? LEGAL_DOCUMENT_FALLBACK_EFFECTIVE_DATE,
  ),
  dpoContact: escapeHtml(env.LEGAL_DPO_CONTACT ?? 'Not applicable outside production'),
  euRepresentative: escapeHtml(env.LEGAL_EU_REPRESENTATIVE ?? 'Not applicable outside production'),
  serviceProviders: escapeHtml(env.LEGAL_SERVICE_PROVIDERS ?? 'Not applicable outside production'),
  processingLocations: escapeHtml(
    env.LEGAL_PROCESSING_LOCATIONS ?? 'Not applicable outside production',
  ),
  logBackupRetention: escapeHtml(
    env.LEGAL_LOG_BACKUP_RETENTION ?? 'Not applicable outside production',
  ),
  supportModerationRetention: escapeHtml(
    env.LEGAL_SUPPORT_MODERATION_RETENTION ?? 'Not applicable outside production',
  ),
  moderationAppealRoute: escapeHtml(
    env.LEGAL_MODERATION_APPEAL_ROUTE ?? 'Not applicable outside production',
  ),
  adultContentPolicy: escapeHtml(
    env.LEGAL_ADULT_CONTENT_POLICY ?? 'Not applicable outside production',
  ),
  childSafetyReportingProcess: escapeHtml(
    env.LEGAL_CHILD_SAFETY_REPORTING_PROCESS ?? 'Not applicable outside production',
  ),
  contactPhone: escapeHtml(env.LEGAL_CONTACT_PHONE ?? 'Not applicable outside production'),
  privacyEmail: escapeHtml(env.PRIVACY_CONTACT_EMAIL ?? 'privacy@example.invalid'),
  supportEmail: escapeHtml(env.SUPPORT_CONTACT_EMAIL ?? 'support@example.invalid'),
  safetyEmail: escapeHtml(env.SAFETY_CONTACT_EMAIL ?? 'safety@example.invalid'),
  childSafetyContactName: escapeHtml(
    env.CHILD_SAFETY_CONTACT_NAME ?? 'Not applicable outside production',
  ),
  childSafetyEmail: escapeHtml(env.CHILD_SAFETY_CONTACT_EMAIL ?? 'child-safety@example.invalid'),
};

const appleTeamId = env.APPLE_TEAM_ID ?? 'TESTTEAMID';
const androidAppSigningSha256 =
  env.ANDROID_APP_SIGNING_SHA256 ??
  '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00';

const htmlHeaders = (res: Response, language: LegalLanguage): void => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Language', language);
  res.setHeader('X-ChatHouse-Legal-Document-Version', legalIdentity.documentVersion);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
};

const localizedPath = (path: string, language: LegalLanguage): string =>
  language === 'fr' ? `${path}?lang=fr` : path;

const layout = (language: LegalLanguage, title: string, body: string): string => `<!doctype html>
<html lang="${language}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
  </head>
  <body>
    <header>
      <h1>${title}</h1>
      <p>${
        language === 'fr'
          ? `ChatHouse · Version : ${legalIdentity.documentVersion} · Date d’entrée en vigueur : ${legalIdentity.effectiveDate}`
          : `ChatHouse · Version: ${legalIdentity.documentVersion} · Effective date: ${legalIdentity.effectiveDate}`
      }</p>
      <nav aria-label="${language === 'fr' ? 'Langue' : 'Language'}">
        <a lang="en" href="?lang=en">English</a> ·
        <a lang="fr" href="?lang=fr">Français</a>
      </nav>
    </header>
    <main>${body}</main>
    <footer>
      <p>${legalIdentity.entity} · ${legalIdentity.address}</p>
      <p>${
        language === 'fr' ? 'Contact confidentialité' : 'Privacy contact'
      } : <a href="mailto:${legalIdentity.privacyEmail}">${legalIdentity.privacyEmail}</a></p>
    </footer>
  </body>
</html>`;

const privacyPolicy = layout(
  'en',
  'ChatHouse Privacy Policy',
  `
    <section>
      <h2>Controller and contact</h2>
      <p>The data controller is ${legalIdentity.entity}, registered at
      ${legalIdentity.address}, registration number
      ${legalIdentity.registrationNumber}. This policy is governed by the laws
      of ${legalIdentity.jurisdiction}. Privacy enquiries can be sent to
      <a href="mailto:${legalIdentity.privacyEmail}">${legalIdentity.privacyEmail}</a>.</p>
      <p>Data Protection Officer: ${legalIdentity.dpoContact}. EU/EEA
      representative: ${legalIdentity.euRepresentative}.</p>
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
      <p>A phone number, username and age confirmation are required to create and
      secure an account. Profile details, location, diagnostics and most content
      submissions are optional; the related feature cannot work without the
      data it specifically needs.</p>
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
      <ul>
        <li><strong>Contract:</strong> create/authenticate accounts; deliver
        rooms, messages, profiles, social features, notifications and supported
        purchases.</li>
        <li><strong>Consent:</strong> optional map/location visibility and
        optional mobile crash diagnostics. Consent can be withdrawn in Settings
        or through the relevant device permission.</li>
        <li><strong>Legitimate interests:</strong> secure infrastructure,
        prevent fraud and abuse, moderate content, provide support and improve
        relevant discovery, balanced against user rights.</li>
        <li><strong>Legal obligation:</strong> respond to valid legal requests,
        retain narrowly required records and meet safety, accounting or
        regulatory duties.</li>
      </ul>
      <p>Explore may rank people, rooms or results using account activity, and
      security systems may flag suspicious activity. ChatHouse does not make
      solely automated decisions intended to produce legal or similarly
      significant effects on a user.</p>
    </section>
    <section>
      <h2>Processors and transfers</h2>
      <p>Depending on enabled features, data is processed for us by infrastructure
      and private object-storage providers, Twilio (authentication SMS), Firebase
      and Apple Push Notification service (notifications), LiveKit (live audio),
      Stripe (payments), and Sentry (opt-in mobile diagnostics and restricted
      server reliability diagnostics). Map rendering can involve CARTO and
      OpenStreetMap tiles, Apple MapKit or Google Maps Platform depending on the
      shipped platform. Resend or the configured production mail provider
      delivers service and support email. We do not sell personal data, use it
      for cross-app advertising, or share it with data brokers.</p>
      <p>Reviewed production provider inventory: ${legalIdentity.serviceProviders}.</p>
      <p>Production processing and storage locations:
      ${legalIdentity.processingLocations}.</p>
      <p>Where a transfer leaves the applicable jurisdiction, the safeguards are:
      ${legalIdentity.transferSafeguards}.</p>
    </section>
    <section>
      <h2>Retention and deletion</h2>
      <p>Active-account content is retained while needed to provide the service.
      A self-service deletion request immediately disables the account, clears
      map location, revokes sessions and removes push tokens. The account remains
      in a 30-day recovery period. A successful sign-in during that period opens
      a recovery-only session; the account is restored only after explicit
      confirmation. Otherwise the database records and private media are
      permanently purged. Moderation bans cannot be self-restored.</p>
      <p>Expired authentication artefacts are removed on short schedules.
      Infrastructure logs and backup deletion propagation:
      ${legalIdentity.logBackupRetention}. Support and moderation records:
      ${legalIdentity.supportModerationRetention}. A processor may retain
      narrowly required financial or legal records for the period imposed by
      law; any such exception is isolated from normal product use.</p>
      <p><a href="/account-deletion">Request account and associated-data deletion</a>.</p>
    </section>
    <section>
      <h2>Your choices and rights</h2>
      <p>Users can edit their profile, disable location and notifications,
      withdraw crash-reporting consent, export a structured copy of their data,
      and request deletion in the app. Depending on local law, users may also
      request access, correction, restriction, objection, portability or
      erasure, and complain to their supervisory authority.</p>
      <p>Where the GDPR applies, privacy requests are normally answered within
      one month, subject to lawful extensions and identity verification.</p>
      <p>The relevant supervisory authority is ${legalIdentity.authority}.</p>
    </section>
    <section>
      <h2>Children</h2>
      <p>ChatHouse is not intended for children under 16. Account creation
      requires a 16-or-over self-attestation and the server rejects registration
      without it.</p>
      <p>Child sexual exploitation, abuse and child sexual abuse material are
      prohibited. Read the <a href="/child-safety">Child Safety Standards</a>
      and <a href="/community-guidelines">Community Guidelines</a>.</p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>Email <a href="mailto:${legalIdentity.privacyEmail}">${legalIdentity.privacyEmail}</a>.
      Never send a password, OTP code, access
      token or payment-card number by email.</p>
    </section>
  `,
);

const terms = layout(
  'en',
  'ChatHouse Terms of Use',
  `
    <section>
      <h2>Agreement</h2>
      <p>This End User License Agreement ("Agreement") is between you and
      ${legalIdentity.entity}, registered at ${legalIdentity.address}
      ("ChatHouse", "we", "us"). By creating an account or using the ChatHouse
      app ("App"), you agree to this Agreement. If you do not agree, do not use
      the App.</p>
    </section>
    <section>
      <h2>1. License</h2>
      <p>We grant you a limited, non-exclusive, non-transferable, revocable
      license to use the App on devices you own or control, for personal,
      non-commercial use, subject to this Agreement and the applicable Apple
      Media Services or Google Play terms.</p>
      <p>For an App obtained from Apple's App Store, the license is limited to
      Apple-branded products you own or control as permitted by the Apple Media
      Services Usage Rules, except for access through Family Sharing, volume
      purchasing or another Apple-authorized feature.</p>
    </section>
    <section>
      <h2>2. Eligibility</h2>
      <p>You must be at least 16 years old, or the older of 16 and the minimum
      age of digital consent in your country, to use the App.</p>
    </section>
    <section>
      <h2>3. Accounts</h2>
      <p>You are responsible for activity under your account and for keeping
      your phone number and one-time codes secure. Provide accurate information
      and keep it current. We may suspend or terminate accounts that violate
      this Agreement.</p>
    </section>
    <section>
      <h2>4. User-generated content</h2>
      <p>The App lets you broadcast live audio, send text and voice messages,
      and create profiles, room titles and reactions ("User Content"). You
      retain ownership of your User Content. You grant us a worldwide,
      non-exclusive, royalty-free license to host, store, reproduce, transmit,
      format and display your User Content only as needed to operate, secure
      and improve the App, follow your instructions, enforce this Agreement
      and meet legal obligations. The license ends when content is deleted
      from our systems, subject to content already delivered to another user,
      recovery/backup cycles and narrow lawful retention.</p>
      <p>You are responsible for your User Content and represent that you have
      the rights to share it and that it does not violate this Agreement or any
      law.</p>
    </section>
    <section>
      <h2>5. Acceptable use</h2>
      <p>There is no tolerance for objectionable content or abusive behavior.
      You must not use the App to:</p>
      <ul>
        <li>harass, bully, threaten, defame or impersonate anyone;</li>
        <li>post or transmit hateful, sexually explicit, violent or illegal
        content, or content that exploits or endangers minors;</li>
        <li>infringe intellectual-property or privacy rights;</li>
        <li>spam, defraud, phish or distribute malware;</li>
        <li>record or share another person's audio or personal information
        without a lawful basis or required consent; or</li>
        <li>disrupt, reverse-engineer, scrape or circumvent App security or rate
        limits.</li>
      </ul>
    </section>
    <section>
      <h2>6. Safety tools</h2>
      <p>You can report users or rooms and block users in the App. We review
      reports and may remove content, warn users, eject them from rooms, or
      suspend or terminate accounts. Reports are prioritized according to
      apparent severity, immediacy and legal obligations. We do not promise a
      fixed response time that the moderation operation has not formally
      adopted. The in-app report tool is not an emergency service.</p>
      <p>The <a href="/community-guidelines">Community Guidelines</a> and
      <a href="/child-safety">Child Safety Standards</a> form part of this
      Agreement.</p>
    </section>
    <section>
      <h2>7. Purchases</h2>
      <p>The current Android and iOS store builds do not initiate tips, premium
      checkout or other digital purchases. If those features are introduced
      later, applicable platform billing rules and disclosures will apply.
      Except where required by law or platform policy, payments are
      non-refundable.</p>
    </section>
    <section>
      <h2>8. Privacy</h2>
      <p>Your use of the App is also governed by the
      <a href="/privacy">ChatHouse Privacy Policy</a>, which explains what data
      we process and your rights.</p>
    </section>
    <section>
      <h2>9. Disclaimers</h2>
      <p>THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF
      ANY KIND, TO THE MAXIMUM EXTENT PERMITTED BY LAW. We do not warrant that
      the App will be uninterrupted, secure or error-free.</p>
    </section>
    <section>
      <h2>10. Limitation of liability</h2>
      <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, CHATHOUSE WILL NOT BE LIABLE
      FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR
      LOSS OF DATA, PROFITS OR GOODWILL. Some jurisdictions do not allow these
      limitations, so they may not apply to you.</p>
      <p>Reviewed liability cap and mandatory-law carve-outs:
      ${legalIdentity.liabilityTerms}.</p>
    </section>
    <section>
      <h2>11. Termination</h2>
      <p>You may stop using the App and
      <a href="/account-deletion">delete your account</a> at any time. We may
      suspend or terminate your access for violations of this Agreement.
      Sections that by their nature should survive, including ownership,
      disclaimers and liability, survive termination.</p>
    </section>
    <section>
      <h2>12. Apple and Google terms</h2>
      <p>This Agreement is between you and ChatHouse, not Apple or Google. The
      platform providers are not responsible for the App or its content.
      Maintenance, support and warranty obligations are ours, not the
      platform's, subject to applicable law and platform terms. ChatHouse, not
      Apple, is responsible for product, regulatory, consumer-protection and
      intellectual-property claims relating to the App. If a third party claims
      that the App or your possession and use of it infringes intellectual
      property, ChatHouse is responsible for investigating, defending,
      settling and discharging that claim to the extent required by applicable
      law.</p>
      <p>If an App Store version fails to conform to an applicable warranty, you
      may notify Apple and Apple will refund its purchase price, if any. To the
      maximum extent permitted by law, Apple has no other warranty obligation.
      Apple and its subsidiaries are third-party beneficiaries and may enforce
      this Agreement after your acceptance.</p>
    </section>
    <section>
      <h2>13. Legal and export compliance</h2>
      <p>You represent that you are not located in a country subject to a United
      States Government embargo or designated as supporting terrorism and are
      not listed on a United States Government list of prohibited or restricted
      parties. You must comply with other sanctions, export-control and local
      laws applicable to you and the App.</p>
    </section>
    <section>
      <h2>14. Governing law and changes</h2>
      <p>This Agreement is governed by the laws of
      ${legalIdentity.jurisdiction}, without regard to conflict-of-laws rules.
      Reviewed courts or dispute process: ${legalIdentity.disputeProcess}.
      Mandatory consumer protections and jurisdiction rights in your country of
      residence remain unaffected. Material changes will be identified by a new
      version and communicated as required by law; renewed acceptance will be
      requested where required.</p>
    </section>
    <section>
      <h2>15. Contact</h2>
      <p>${legalIdentity.entity}, ${legalIdentity.address}. For questions about
      these terms, visit <a href="/support">ChatHouse Support</a> or email
      <a href="mailto:${legalIdentity.supportEmail}">${legalIdentity.supportEmail}</a>.
      Telephone: ${legalIdentity.contactPhone}.
      Do not send passwords, OTP codes, access tokens or full payment-card
      details.</p>
    </section>
  `,
);

const communityGuidelines = layout(
  'en',
  'ChatHouse Community Guidelines',
  `
    <section>
      <h2>Scope</h2>
      <p>These Guidelines apply to profiles, live audio, room titles, messages,
      voice messages, reactions, clubs and every other ChatHouse interaction.
      They form part of the Terms of Use.</p>
    </section>
    <section>
      <h2>Prohibited conduct</h2>
      <ul>
        <li>Harassment, threats, bullying, stalking, doxxing, discrimination or
        impersonation;</li>
        <li>Hateful, non-consensual sexual, exploitative, violent or illegal
        content;</li>
        <li>Child sexual exploitation or abuse, grooming, sexualization of a
        minor, or child sexual abuse material;</li>
        <li>Privacy, intellectual-property or recording-rights violations;</li>
        <li>Fraud, spam, phishing, malware, unauthorized automation, scraping or
        attempts to evade security, blocks or moderation.</li>
      </ul>
      <p>Reviewed policy for otherwise lawful adult sexual content:
      ${legalIdentity.adultContentPolicy}.</p>
    </section>
    <section>
      <h2>Reporting, blocking and enforcement</h2>
      <p>Use the in-app Report action for a user or room and use Block to stop
      further interaction. Hosts and moderators can mute or remove disruptive
      participants where the feature permits it. We may restrict content or
      features, end a room, preserve relevant evidence, warn a user, or suspend
      or terminate an account.</p>
      <p>The report tool is not an emergency service. Contact local emergency
      services for immediate danger. For another safety issue, email
      <a href="mailto:${legalIdentity.safetyEmail}">${legalIdentity.safetyEmail}</a>.</p>
      <p>Moderation decisions can be challenged through:
      ${legalIdentity.moderationAppealRoute}. The operator publishes no response
      time that its moderation operation has not formally adopted and tested.</p>
    </section>
    <section>
      <h2>Related standards</h2>
      <p><a href="/child-safety">Read the Child Safety Standards</a>.</p>
      <p><a href="/terms">Read the Terms of Use</a>.</p>
    </section>
  `,
);

const childSafety = layout(
  'en',
  'ChatHouse Child Safety Standards',
  `
    <section>
      <h2>Zero tolerance</h2>
      <p>ChatHouse, operated by ${legalIdentity.entity}, prohibits child sexual
      exploitation and abuse (CSAE) and child sexual abuse material (CSAM)
      throughout the service. Users must not create, request, possess,
      distribute, advertise or facilitate CSAM; groom, coerce, extort, traffic
      or sexually exploit a child; sexualize a minor; or help another person
      evade detection for that activity.</p>
    </section>
    <section>
      <h2>How to report</h2>
      <p>Report a user or room from within the ChatHouse app. If an issue cannot
      be reported in-app, email
      <a href="mailto:${legalIdentity.childSafetyEmail}">${legalIdentity.childSafetyEmail}</a>.
      For immediate danger, contact local emergency services. Do not download
      or redistribute suspected CSAM in an attempt to report it.</p>
    </section>
    <section>
      <h2>Response and compliance</h2>
      <p>ChatHouse assesses child-safety reports, restricts access to known CSAM,
      preserves relevant information where legally permitted and required,
      suspends or terminates involved accounts, and reports material or conduct
      to competent child-protection or law-enforcement authorities where
      required by applicable law.</p>
      <p>Reviewed escalation and legally required reporting process:
      ${legalIdentity.childSafetyReportingProcess}.</p>
      <p>These standards are enforced with the
      <a href="/community-guidelines">Community Guidelines</a> and
      <a href="/terms">Terms of Use</a>.</p>
    </section>
    <section>
      <h2>Contact</h2>
      <p>${legalIdentity.entity}, ${legalIdentity.address}. Designated
      child-safety contact: ${legalIdentity.childSafetyContactName}. Email:
      <a href="mailto:${legalIdentity.childSafetyEmail}">${legalIdentity.childSafetyEmail}</a>.
      Telephone: ${legalIdentity.contactPhone}.</p>
    </section>
  `,
);

const accountDeletion = layout(
  'en',
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
      signing in successfully during those 30 days opens a recovery-only
      session. The account is restored, and a still-pending cancellation is
      resumed, only after explicit confirmation. If no restoration occurs,
      account data and private media are permanently
      purged. Narrow records may be retained only where required for security,
      fraud prevention or law, as described in the privacy policy.</p>
      <p>Customer-service deletion request:
      <a href="mailto:${legalIdentity.privacyEmail}?subject=ChatHouse%20account%20deletion%20request">email ${legalIdentity.privacyEmail}</a>.</p>
      <p><a href="/privacy">Read the ChatHouse Privacy Policy</a>.</p>
    </section>
  `,
);

const support = layout(
  'en',
  'ChatHouse Support',
  `
    <section>
      <h2>Contact support</h2>
      <p>For account access, safety, technical or billing support, email
      <a href="mailto:${legalIdentity.supportEmail}">${legalIdentity.supportEmail}</a>.
      Do not send passwords, OTP codes, access tokens or full payment-card details.</p>
    </section>
    <section>
      <h2>Legal resources and account deletion</h2>
      <p><a href="/privacy">Read the Privacy Policy</a>.</p>
      <p><a href="/terms">Read the Terms of Use</a>.</p>
      <p><a href="/community-guidelines">Read the Community Guidelines</a>.</p>
      <p><a href="/child-safety">Read the Child Safety Standards</a>.</p>
      <p><a href="/account-deletion">Request account and associated-data deletion</a>.</p>
    </section>
  `,
);

const privacyPolicyFr = layout(
  'fr',
  'Politique de confidentialité de ChatHouse',
  `
    <section>
      <h2>1. Responsable du traitement et contacts</h2>
      <p>Le responsable du traitement est ${legalIdentity.entity}, immatriculé
      sous le numéro ${legalIdentity.registrationNumber} et établi à
      ${legalIdentity.address}. Les demandes relatives à la confidentialité
      peuvent être envoyées à
      <a href="mailto:${legalIdentity.privacyEmail}">${legalIdentity.privacyEmail}</a>.</p>
      <p>Délégué à la protection des données : ${legalIdentity.dpoContact}.
      Représentant dans l’UE/EEE : ${legalIdentity.euRepresentative}.</p>
    </section>
    <section>
      <h2>2. Données traitées</h2>
      <p>Nous traitons les identifiants et données de profil, notamment le numéro
      de téléphone, l’adresse e-mail lorsqu’elle est fournie, le nom
      d’utilisateur, le nom d’affichage, l’image de profil, la biographie, les
      centres d’intérêt et les liens sociaux ; les relations sociales ; les
      salons et la participation ; les messages directs, de groupe, de salon et
      vocaux ; les clubs ; les signalements et dossiers de modération ; les
      jetons et préférences de notification ; l’historique des achats et droits
      d’accès ; les recherches Explorer ; ainsi que les données de sécurité
      telles que l’adresse IP, l’agent utilisateur et les horodatages de
      connexion.</p>
      <p>Le numéro de téléphone, le nom d’utilisateur et la confirmation d’âge
      sont nécessaires à la création et à la sécurisation du compte. Le profil
      complémentaire, la localisation, les diagnostics et la plupart des
      contenus sont facultatifs ; la fonctionnalité correspondante ne peut pas
      fonctionner sans les données dont elle a besoin.</p>
      <p>La localisation précise ou approximative est facultative et désactivée
      par défaut. Lorsqu’un utilisateur active sa visibilité, les autres
      utilisateurs visibles peuvent voir sa position sur la carte. La
      désactivation efface les coordonnées enregistrées et les coordonnées
      obsolètes sont automatiquement purgées.</p>
      <p>L’enregistrement des salons et les rediffusions sont désactivés. L’audio
      en direct est transporté sans être enregistré par ChatHouse ; les messages
      vocaux créés volontairement sont conservés comme médias privés.</p>
    </section>
    <section>
      <h2>3. Finalités et bases juridiques</h2>
      <ul>
        <li><strong>Contrat :</strong> créer et authentifier les comptes, fournir
        les salons, messages, profils, fonctions sociales, notifications et
        achats pris en charge.</li>
        <li><strong>Consentement :</strong> visibilité cartographique et
        diagnostics mobiles facultatifs ; le consentement peut être retiré dans
        les réglages ou par l’autorisation de l’appareil.</li>
        <li><strong>Intérêts légitimes :</strong> sécuriser l’infrastructure,
        prévenir la fraude et les abus, modérer, assister et améliorer la
        découverte, après mise en balance avec les droits des personnes.</li>
        <li><strong>Obligation légale :</strong> répondre aux demandes valides et
        respecter les obligations de sécurité, comptables et réglementaires.</li>
      </ul>
      <p>Explorer peut classer des résultats à partir de l’activité du compte et
      les mécanismes de sécurité peuvent signaler une activité suspecte.
      ChatHouse ne prend pas de décision exclusivement automatisée destinée à
      produire un effet juridique ou similaire significatif.</p>
    </section>
    <section>
      <h2>4. Destinataires, prestataires et transferts</h2>
      <p>Les autres utilisateurs reçoivent les données que la fonctionnalité et
      vos choix rendent visibles. Les catégories de prestataires peuvent inclure
      l’hébergement et le stockage privé, les SMS d’authentification, les
      notifications Firebase/APNs, LiveKit pour l’audio, les paiements, les
      diagnostics consentis, les cartes et tuiles, ainsi que l’envoi d’e-mails.
      ChatHouse ne vend pas les données, ne les utilise pas pour la publicité
      inter-applications et ne les communique pas à des courtiers.</p>
      <p>Inventaire validé des prestataires de production :
      ${legalIdentity.serviceProviders}.</p>
      <p>Pays et régions de traitement ou de stockage :
      ${legalIdentity.processingLocations}.</p>
      <p>Garanties applicables aux transferts internationaux :
      ${legalIdentity.transferSafeguards}.</p>
    </section>
    <section>
      <h2>5. Conservation et suppression</h2>
      <p>Le contenu d’un compte actif est conservé pendant la fourniture du
      service. Une demande de suppression désactive immédiatement le compte,
      efface la visibilité cartographique, révoque les sessions et supprime les
      jetons push. Pendant les 30 jours suivant une auto-suppression, une
      connexion réussie ouvre uniquement une session de récupération ; le compte
      n’est restauré qu’après confirmation explicite. Sans restauration, les
      données et médias privés sont définitivement purgés. Un bannissement de
      modération ne peut pas être restauré par l’utilisateur.</p>
      <p>Journaux d’infrastructure, sauvegardes et propagation de la suppression :
      ${legalIdentity.logBackupRetention}. Dossiers d’assistance et de
      modération : ${legalIdentity.supportModerationRetention}. Des
      enregistrements strictement nécessaires peuvent être isolés pendant la
      durée imposée par la loi, la sécurité, la fraude ou un litige.</p>
      <p><a href="${localizedPath('/account-deletion', 'fr')}">Demander la
      suppression du compte et des données associées</a>.</p>
    </section>
    <section>
      <h2>6. Choix et droits</h2>
      <p>Vous pouvez modifier votre profil, désactiver la localisation et les
      notifications, retirer le consentement aux diagnostics, exporter vos
      données et supprimer votre compte. Selon la loi applicable, vous pouvez
      également demander l’accès, la rectification, la limitation,
      l’opposition, la portabilité ou l’effacement, et introduire une
      réclamation auprès d’une autorité de contrôle.</p>
      <p>Lorsque le RGPD s’applique, nous répondons normalement dans un délai
      d’un mois, sous réserve des prolongations légales et de la vérification de
      l’identité. Autorité compétente : ${legalIdentity.authority}.</p>
    </section>
    <section>
      <h2>7. Enfants et protection de l’enfance</h2>
      <p>ChatHouse ne s’adresse pas aux personnes de moins de 16 ans. La création
      du compte exige une déclaration confirmant cet âge minimum. L’exploitation
      et les abus sexuels concernant des enfants, ainsi que les matériels d’abus
      sexuels sur enfants, sont interdits. Consultez les
      <a href="${localizedPath('/child-safety', 'fr')}">Normes de protection de
      l’enfance</a> et les
      <a href="${localizedPath('/community-guidelines', 'fr')}">Règles de la
      communauté</a>.</p>
    </section>
    <section>
      <h2>8. Sécurité, modifications et contact</h2>
      <p>Les mesures comprennent le chiffrement en transit, le hachage à sens
      unique de secrets, des jetons à courte durée de vie, le stockage sécurisé
      sur l’appareil, le stockage privé d’objets, les contrôles d’accès, la
      limitation du débit et les journaux d’audit. Aucun système ne peut être
      garanti comme totalement sécurisé.</p>
      <p>Une modification substantielle reçoit une nouvelle version et est
      communiquée comme l’exige la loi. Lorsqu’un consentement est requis pour
      une nouvelle finalité, il est demandé avant le traitement.</p>
      <p>Contact :
      <a href="mailto:${legalIdentity.privacyEmail}">${legalIdentity.privacyEmail}</a>.
      N’envoyez jamais de mot de passe, code à usage unique, jeton d’accès ou
      numéro complet de carte bancaire par e-mail.</p>
    </section>
  `,
);

const termsFr = layout(
  'fr',
  'Conditions d’utilisation de ChatHouse',
  `
    <section>
      <h2>Contrat</h2>
      <p>Le présent contrat de licence utilisateur final (« Contrat ») est conclu
      entre vous et ${legalIdentity.entity}, établi à
      ${legalIdentity.address} (« ChatHouse », « nous »), au sujet de
      l’application et du service ChatHouse (« Application »). Il est conclu avec
      ChatHouse, et non avec Apple ou Google. Si vous n’acceptez pas le Contrat,
      n’utilisez pas l’Application.</p>
    </section>
    <section>
      <h2>1. Licence et plateformes</h2>
      <p>Nous vous accordons une licence personnelle, limitée, non exclusive,
      non transférable, non sous-licenciable et révocable afin d’utiliser
      l’Application légalement et à des fins non commerciales sur les appareils
      que vous possédez ou contrôlez. Pour l’App Store, cette licence est limitée
      aux produits Apple conformément aux règles d’utilisation Apple, y compris
      les usages autorisés par le Partage familial ou d’autres fonctions
      Apple.</p>
    </section>
    <section>
      <h2>2. Âge et compte</h2>
      <p>Vous devez avoir au moins 16 ans, ou l’âge minimum supérieur exigé dans
      votre pays. Vous devez fournir des informations exactes, protéger votre
      numéro de téléphone et vos codes à usage unique, et signaler tout accès
      suspect.</p>
    </section>
    <section>
      <h2>3. Contenu utilisateur</h2>
      <p>Vous conservez la propriété du contenu que vous soumettez. Vous nous
      accordez une licence mondiale, non exclusive et gratuite, limitée à
      l’hébergement, au stockage, à la reproduction, à la transmission, à la
      mise en forme et à l’affichage nécessaires au fonctionnement, à la
      sécurité, à l’amélioration, à la modération et aux obligations légales.
      Cette licence prend fin lors de la suppression, sous réserve du contenu
      déjà transmis, des sauvegardes et d’une conservation légale limitée.</p>
    </section>
    <section>
      <h2>4. Utilisations interdites</h2>
      <p>Vous ne devez pas harceler, menacer, discriminer, usurper une identité,
      publier un contenu haineux, violent, frauduleux, intime non consenti ou
      illégal, exploiter un enfant ou diffuser du matériel d’abus sexuels sur
      enfants, enfreindre des droits, enregistrer une personne sans base légale,
      envoyer du spam ou des logiciels malveillants, extraire des données,
      pratiquer l’ingénierie inverse ou contourner la sécurité, la modération et
      les limitations de débit.</p>
      <p>Politique validée concernant les contenus sexuels adultes par ailleurs
      licites : ${legalIdentity.adultContentPolicy}.</p>
    </section>
    <section>
      <h2>5. Signalement, blocage et modération</h2>
      <p>Vous pouvez signaler un utilisateur ou un salon et bloquer un
      utilisateur. Nous pouvons restreindre un contenu ou une fonctionnalité,
      fermer un salon, préserver des preuves, avertir, suspendre ou résilier un
      compte. Les signalements sont priorisés selon leur gravité, leur urgence et
      les obligations légales. L’outil de signalement n’est pas un service
      d’urgence.</p>
      <p>Voie de recours validée : ${legalIdentity.moderationAppealRoute}. Les
      <a href="${localizedPath('/community-guidelines', 'fr')}">Règles de la
      communauté</a> et les
      <a href="${localizedPath('/child-safety', 'fr')}">Normes de protection de
      l’enfance</a> font partie du Contrat.</p>
    </section>
    <section>
      <h2>6. Achats</h2>
      <p>La version mobile actuelle ne permet pas d’initier un achat numérique.
      Si cette situation change, le moyen de facturation de la plateforme, le
      prix, le renouvellement, la résiliation et les remboursements seront
      présentés avant l’achat. Les droits impératifs de remboursement restent
      applicables.</p>
    </section>
    <section>
      <h2>7. Confidentialité</h2>
      <p>La <a href="${localizedPath('/privacy', 'fr')}">Politique de
      confidentialité</a> décrit les données traitées et vos droits. Accepter le
      Contrat ne transforme pas tous les traitements en traitements fondés sur
      le consentement.</p>
    </section>
    <section>
      <h2>8. Propriété intellectuelle</h2>
      <p>À l’exception du contenu utilisateur, ChatHouse et ses concédants
      détiennent les droits relatifs à l’Application. ChatHouse, et non Apple,
      est responsable de l’instruction, de la défense, du règlement et de la
      résolution d’une réclamation d’un tiers alléguant une atteinte à ses
      droits de propriété intellectuelle, dans la mesure exigée par la loi.</p>
    </section>
    <section>
      <h2>9. Maintenance, assistance et réclamations</h2>
      <p>ChatHouse est responsable de la maintenance, de l’assistance et des
      réclamations relatives au produit, à la réglementation et à la protection
      des consommateurs. Apple et Google n’ont aucune obligation de maintenance
      ou d’assistance. Contact :
      <a href="mailto:${legalIdentity.supportEmail}">${legalIdentity.supportEmail}</a>,
      ${legalIdentity.contactPhone}.</p>
    </section>
    <section>
      <h2>10. Garantie et remboursement App Store</h2>
      <p>L’APPLICATION EST FOURNIE « EN L’ÉTAT » ET « SELON DISPONIBILITÉ », SOUS
      RÉSERVE DES GARANTIES QUI NE PEUVENT ÊTRE LÉGALEMENT EXCLUES. Si une
      application obtenue sur l’App Store ne respecte pas une garantie
      applicable, vous pouvez en informer Apple, qui remboursera le prix d’achat
      éventuel. Dans la limite permise par la loi, Apple n’a aucune autre
      obligation de garantie.</p>
    </section>
    <section>
      <h2>11. Limitation de responsabilité</h2>
      <p>Dans la mesure maximale autorisée par la loi, ChatHouse n’est pas
      responsable des dommages indirects, accessoires, spéciaux, consécutifs ou
      punitifs, ni de la perte de données, de bénéfices ou de clientèle. Cette
      disposition n’exclut aucune responsabilité ni aucun droit du consommateur
      qui ne peut être légalement exclu.</p>
      <p>Plafond de responsabilité et exceptions légales validés :
      ${legalIdentity.liabilityTerms}.</p>
    </section>
    <section>
      <h2>12. Conformité juridique et exportations</h2>
      <p>Vous déclarez ne pas être situé dans un pays soumis à un embargo du
      gouvernement des États-Unis ou désigné comme soutenant le terrorisme, et
      ne figurer sur aucune liste américaine de parties interdites ou
      restreintes. Vous devez respecter les autres sanctions, contrôles des
      exportations et lois locales applicables.</p>
    </section>
    <section>
      <h2>13. Résiliation et suppression</h2>
      <p>Vous pouvez cesser d’utiliser l’Application et
      <a href="${localizedPath('/account-deletion', 'fr')}">supprimer votre
      compte</a>. Nous pouvons restreindre ou résilier l’accès afin d’appliquer le
      Contrat, protéger les utilisateurs ou respecter la loi. Les clauses qui,
      par nature, doivent survivre à la résiliation demeurent applicables.</p>
    </section>
    <section>
      <h2>14. Droit applicable et modifications</h2>
      <p>Le Contrat est régi par le droit de
      ${legalIdentity.jurisdiction}. Tribunaux ou procédure de règlement des
      litiges validés : ${legalIdentity.disputeProcess}. Les protections
      impératives du consommateur
      et les droits de juridiction du pays de résidence restent inchangés. Une
      modification substantielle reçoit une nouvelle version et est communiquée
      comme l’exige la loi ; une nouvelle acceptation est demandée si nécessaire.</p>
    </section>
    <section>
      <h2>15. Relation avec Apple et coordonnées</h2>
      <p>Apple et ses filiales sont bénéficiaires tiers du Contrat et peuvent le
      faire respecter après votre acceptation. Développeur :
      ${legalIdentity.entity}, ${legalIdentity.address}. Assistance :
      <a href="mailto:${legalIdentity.supportEmail}">${legalIdentity.supportEmail}</a>.
      Téléphone : ${legalIdentity.contactPhone}.</p>
    </section>
  `,
);

const communityGuidelinesFr = layout(
  'fr',
  'Règles de la communauté ChatHouse',
  `
    <section>
      <h2>Champ d’application</h2>
      <p>Ces règles s’appliquent aux profils, salons audio en direct, titres,
      messages texte et vocaux, réactions, clubs et autres interactions. Elles
      font partie des Conditions d’utilisation.</p>
    </section>
    <section>
      <h2>Respect et sécurité</h2>
      <p>Le harcèlement, les menaces, l’intimidation, la traque, la divulgation
      de données privées, la discrimination, l’usurpation d’identité,
      l’incitation à la violence, au suicide, à l’automutilation ou à des actes
      dangereux sont interdits.</p>
    </section>
    <section>
      <h2>Contenu sexuel et sécurité des enfants</h2>
      <p>L’exploitation ou les abus sexuels concernant un enfant, la préparation
      à des fins sexuelles, la sexualisation d’un mineur, la sollicitation de
      contenu sexuel d’un mineur, ainsi que la création, la possession, la
      distribution ou la facilitation de matériels d’abus sexuels sur enfants
      sont interdits. Les contenus intimes non consentis, l’extorsion sexuelle et
      les menaces de diffusion sont également interdits.</p>
      <p>Politique validée concernant les contenus sexuels adultes par ailleurs
      licites : ${legalIdentity.adultContentPolicy}.</p>
    </section>
    <section>
      <h2>Autres conduites interdites</h2>
      <p>Sont interdits la haine ou la déshumanisation fondées sur une
      caractéristique protégée, le terrorisme, l’extrémisme violent, la traite,
      les armes ou substances illégales, la fraude, les atteintes à la vie
      privée ou à la propriété intellectuelle, les enregistrements sans
      autorisation, le spam, l’hameçonnage, les logiciels malveillants,
      l’automatisation non autorisée, l’extraction de données et le contournement
      des mesures de sécurité ou de modération.</p>
    </section>
    <section>
      <h2>Signalement et blocage</h2>
      <p>Utilisez l’action Signaler sur un utilisateur ou un salon et Bloquer
      pour empêcher de nouvelles interactions. Les hôtes et modérateurs peuvent
      mettre en sourdine ou exclure les participants lorsque la fonctionnalité
      le permet. Pour un problème qui ne peut pas être signalé dans
      l’application, contactez
      <a href="mailto:${legalIdentity.safetyEmail}">${legalIdentity.safetyEmail}</a>.
      En cas de danger immédiat, contactez les services d’urgence locaux.</p>
    </section>
    <section>
      <h2>Examen, application et recours</h2>
      <p>ChatHouse peut restreindre du contenu ou des fonctionnalités, fermer un
      salon, préserver des preuves, avertir, suspendre ou résilier un compte, et
      informer les autorités lorsqu’une obligation légale l’impose. La gravité,
      le contexte, la récidive et le risque immédiat influencent la réponse.</p>
      <p>Voie de recours validée : ${legalIdentity.moderationAppealRoute}. Aucun
      délai de traitement n’est promis s’il n’a pas été formellement adopté,
      doté en personnel et testé.</p>
    </section>
    <section>
      <h2>Coordonnées</h2>
      <p>Opérateur : ${legalIdentity.entity}. Sécurité :
      <a href="mailto:${legalIdentity.safetyEmail}">${legalIdentity.safetyEmail}</a>.
      Assistance :
      <a href="mailto:${legalIdentity.supportEmail}">${legalIdentity.supportEmail}</a>.
      Consultez aussi les
      <a href="${localizedPath('/child-safety', 'fr')}">Normes de protection de
      l’enfance</a> et les
      <a href="${localizedPath('/terms', 'fr')}">Conditions d’utilisation</a>.</p>
    </section>
  `,
);

const childSafetyFr = layout(
  'fr',
  'Normes de protection de l’enfance ChatHouse',
  `
    <section>
      <h2>Tolérance zéro</h2>
      <p>ChatHouse, exploité par ${legalIdentity.entity}, interdit l’exploitation
      et les abus sexuels concernant des enfants (« CSAE »), ainsi que les
      matériels d’abus sexuels sur enfants (« CSAM »), dans tout le service.
      Cette interdiction s’applique même si le service ne s’adresse pas aux
      enfants et exige un âge minimum de 16 ans ou l’âge supérieur imposé
      localement.</p>
    </section>
    <section>
      <h2>Conduites interdites</h2>
      <p>Il est interdit de créer, téléverser, posséder, demander, distribuer,
      promouvoir ou faciliter du CSAM ; de préparer, contraindre, extorquer,
      soumettre à la traite ou exploiter sexuellement un enfant ; de sexualiser
      un mineur ou de solliciter des images, sons, vidéos ou rencontres à
      caractère sexuel ; de menacer de diffuser un contenu sexuel impliquant un
      mineur ; ou d’aider une personne à échapper à la détection.</p>
    </section>
    <section>
      <h2>Signalement</h2>
      <p>Signalez un utilisateur ou un salon depuis l’application. Si le
      signalement ne peut pas être envoyé dans l’application, écrivez à
      <a href="mailto:${legalIdentity.childSafetyEmail}">${legalIdentity.childSafetyEmail}</a>.
      En cas de danger immédiat, contactez les services d’urgence locaux. Ne
      téléchargez pas et ne redistribuez pas de CSAM présumé pour le signaler.</p>
    </section>
    <section>
      <h2>Réponse et conformité</h2>
      <p>ChatHouse évalue les signalements, restreint l’accès au CSAM connu,
      conserve les informations pertinentes lorsque la loi le permet ou
      l’exige, suspend ou résilie les comptes concernés et signale les matériels
      ou conduites aux autorités compétentes lorsque la loi l’impose. Nous
      répondons aux demandes juridiquement valides dans le respect des lois
      relatives à la vie privée, à la preuve et à la sécurité des enfants.</p>
      <p>Procédure validée d’escalade et de signalement légalement requis :
      ${legalIdentity.childSafetyReportingProcess}.</p>
      <p>Ces normes sont appliquées avec les
      <a href="${localizedPath('/community-guidelines', 'fr')}">Règles de la
      communauté</a> et les
      <a href="${localizedPath('/terms', 'fr')}">Conditions d’utilisation</a>.</p>
    </section>
    <section>
      <h2>Point de contact</h2>
      <p>Opérateur : ${legalIdentity.entity}, ${legalIdentity.address}. Personne
      ou fonction désignée : ${legalIdentity.childSafetyContactName}. E-mail :
      <a href="mailto:${legalIdentity.childSafetyEmail}">${legalIdentity.childSafetyEmail}</a>.
      Téléphone : ${legalIdentity.contactPhone}.</p>
    </section>
  `,
);

const accountDeletionFr = layout(
  'fr',
  'Supprimer un compte ChatHouse',
  `
    <section id="account-deletion">
      <h2>Demander la suppression du compte et des données associées</h2>
      <p>Dans ChatHouse, ouvrez Paramètres → Confidentialité → Supprimer mon
      compte. Si l’application n’est plus installée ou accessible, écrivez à
      <a href="mailto:${legalIdentity.privacyEmail}?subject=Demande%20de%20suppression%20de%20compte%20ChatHouse">${legalIdentity.privacyEmail}</a>
      avec l’objet « Demande de suppression de compte ChatHouse ». Indiquez le
      nom d’utilisateur et le numéro de téléphone ou l’adresse e-mail associés
      afin que l’assistance puisse vérifier que vous contrôlez le compte.</p>
      <p>N’envoyez jamais de mot de passe, code à usage unique, jeton de session
      ou numéro complet de carte bancaire. L’assistance peut demander une preuve
      de contrôle du numéro de téléphone ou de l’adresse e-mail enregistrés.</p>
      <p>La demande désactive immédiatement le profil, la localisation, les
      sessions et les notifications, et empêche le renouvellement d’un
      abonnement Stripe récurrent. Pendant 30 jours, une connexion vérifiée ouvre
      une session limitée à la récupération ; l’auto-suppression n’est annulée
      qu’après confirmation explicite. Sans restauration, les données du compte
      et les médias privés sont définitivement purgés. Des enregistrements
      limités ne sont conservés que lorsqu’ils sont nécessaires à la sécurité, à
      la prévention de la fraude ou au respect de la loi, conformément à la
      <a href="${localizedPath('/privacy', 'fr')}">Politique de
      confidentialité</a>.</p>
    </section>
  `,
);

const supportFr = layout(
  'fr',
  'Assistance ChatHouse',
  `
    <section>
      <h2>Contacter l’assistance</h2>
      <p>Pour l’accès au compte, la sécurité, un problème technique ou une
      question de facturation, écrivez à
      <a href="mailto:${legalIdentity.supportEmail}">${legalIdentity.supportEmail}</a>.
      Pour une question de sécurité ou de modération, écrivez à
      <a href="mailto:${legalIdentity.safetyEmail}">${legalIdentity.safetyEmail}</a>.
      N’envoyez jamais de mot de passe, code à usage unique, jeton d’accès ou
      numéro complet de carte bancaire.</p>
    </section>
    <section>
      <h2>Ressources juridiques</h2>
      <p><a href="${localizedPath('/privacy', 'fr')}">Politique de confidentialité</a></p>
      <p><a href="${localizedPath('/terms', 'fr')}">Conditions d’utilisation</a></p>
      <p><a href="${localizedPath('/community-guidelines', 'fr')}">Règles de la communauté</a></p>
      <p><a href="${localizedPath('/child-safety', 'fr')}">Normes de protection de l’enfance</a></p>
      <p><a href="${localizedPath('/account-deletion', 'fr')}">Suppression du compte et des données associées</a></p>
    </section>
  `,
);

const requestedLanguage = (req: Request): LegalLanguage => (req.query.lang === 'fr' ? 'fr' : 'en');

const sendLegalPage = (
  req: Request,
  res: Response,
  pages: Readonly<Record<LegalLanguage, string>>,
): void => {
  const language = requestedLanguage(req);
  htmlHeaders(res, language);
  res.status(200).send(pages[language]);
};

export const legalRouter: Router = Router();

legalRouter.get('/privacy', (req, res) => {
  sendLegalPage(req, res, { en: privacyPolicy, fr: privacyPolicyFr });
});

legalRouter.get('/terms', (req, res) => {
  sendLegalPage(req, res, { en: terms, fr: termsFr });
});

legalRouter.get('/community-guidelines', (req, res) => {
  sendLegalPage(req, res, { en: communityGuidelines, fr: communityGuidelinesFr });
});

legalRouter.get('/child-safety', (req, res) => {
  sendLegalPage(req, res, { en: childSafety, fr: childSafetyFr });
});

legalRouter.get('/account-deletion', (req, res) => {
  sendLegalPage(req, res, { en: accountDeletion, fr: accountDeletionFr });
});

legalRouter.get('/support', (req, res) => {
  sendLegalPage(req, res, { en: support, fr: supportFr });
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
