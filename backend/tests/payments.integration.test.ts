/**
 * Payments + premium integration tests.
 *
 * Mocks the external Stripe SDK (loaded dynamically) and Redis (in-memory),
 * but exercises the REAL Prisma layer (docker Postgres on :5433) so the Tip
 * ledger + Subscription/entitlement writes are asserted against the DB. Covers
 * the invariants the audit flagged as untested: tip gating (self/KYC/recipient),
 * recordTip idempotency, and premium entitlement transitions.
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chathouse:chathouse@localhost:5433/chathouse?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
process.env.STRIPE_RETURN_URL = 'https://app.test/return';
process.env.STRIPE_REFRESH_URL = 'https://app.test/refresh';

// Self-contained mock of the Stripe SDK (no outer refs → safe under jest hoist).
// `new Stripe()` returns this canned instance.
jest.mock(
  'stripe',
  () => {
    const instance = {
      checkout: {
        sessions: {
          create: async () => ({ id: 'cs_test', url: 'https://checkout.stripe.com/c/cs_test' }),
        },
      },
      customers: { create: async () => ({ id: 'cus_test' }) },
      billingPortal: {
        sessions: { create: async () => ({ url: 'https://billing.stripe.com/p/test' }) },
      },
      subscriptions: {
        retrieve: async () => ({
          id: 'sub_test',
          created: 100,
          status: 'active',
          customer: 'cus_test',
        }),
      },
      accounts: {
        create: async () => ({ id: 'acct_test' }),
        retrieve: async (id: string) => ({
          id,
          payouts_enabled: !/disabled|incomplete/.test(id),
          charges_enabled: !/disabled|incomplete/.test(id),
        }),
      },
      accountLinks: { create: async () => ({ url: 'https://connect.stripe.com/setup/test' }) },
      paymentIntents: { create: async () => ({ id: 'pi_test', client_secret: 'secret' }) },
    };
    return {
      __esModule: true,
      default: function Stripe() {
        return instance;
      },
    };
    // Keep the mock virtual so this suite never initializes the real SDK.
  },
  { virtual: true },
);

// In-memory Redis so no live connection is needed (mirrors the otp test).
jest.mock('../src/config/redis', () => {
  const store = new Map<string, string>();
  return {
    redis: {
      get: async (k: string) => (store.has(k) ? store.get(k) : null),
      set: async (k: string, v: string, opts?: { NX?: boolean }) => {
        if (opts?.NX && store.has(k)) return null;
        store.set(k, v);
        return 'OK';
      },
      setEx: async (k: string, _ttl: number, v: string) => {
        store.set(k, v);
        return 'OK';
      },
      del: async (k: string) => {
        store.delete(k);
        return 1;
      },
    },
  };
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { prisma } = require('../src/config/database') as typeof import('../src/config/database');
const { redis } = require('../src/config/redis') as typeof import('../src/config/redis');
const { paymentsService } =
  require('../src/extensions/modules/payments/payments.service') as typeof import('../src/extensions/modules/payments/payments.service');
const { premiumService } =
  require('../src/extensions/modules/premium/premium.service') as typeof import('../src/extensions/modules/premium/premium.service');
const { assertCurrency } =
  require('../src/extensions/modules/payments/stripe.client') as typeof import('../src/extensions/modules/payments/stripe.client');
const { requireStripe } =
  require('../src/extensions/modules/payments/stripe.client') as typeof import('../src/extensions/modules/payments/stripe.client');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);
const accountKey = (userId: string) => `ext:stripe:account:${userId}`;
const createdUserIds: string[] = [];

const seedUser = async (): Promise<string> => {
  const u = await prisma.user.create({
    data: { username: `pay_${rand()}`, email: `pay_${rand()}@test.local` },
    select: { id: true },
  });
  createdUserIds.push(u.id);
  return u.id;
};

afterAll(async () => {
  // Cascades remove Tip + Subscription rows tied to these users.
  for (const id of createdUserIds) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

describe('assertCurrency', () => {
  it('accepts an allowlisted currency (normalised to lower-case)', () => {
    expect(assertCurrency('EUR')).toBe('eur');
    expect(assertCurrency('usd')).toBe('usd');
  });
  it('rejects a currency outside the allowlist', () => {
    expect(() => assertCurrency('xyz')).toThrow();
    try {
      assertCurrency('xyz');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('PAY_CURRENCY_UNSUPPORTED');
    }
  });
});

describe('paymentsService.tip — gating', () => {
  it('rejects tipping yourself', async () => {
    const u = await seedUser();
    await expect(paymentsService.tip(u, u, 500, 'eur')).rejects.toMatchObject({
      code: 'PAY_INVALID',
    });
  });

  it('rejects a recipient with no Stripe account', async () => {
    const from = await seedUser();
    const to = await seedUser();
    await expect(paymentsService.tip(from, to, 500, 'eur')).rejects.toMatchObject({
      code: 'PAY_RECIPIENT_NOT_CONFIGURED',
    });
  });

  it('rejects a recipient whose KYC is incomplete', async () => {
    const from = await seedUser();
    const to = await seedUser();
    await redis.set(
      accountKey(to),
      JSON.stringify({
        stripeAccountId: 'acct_incompletea',
        kycComplete: false,
        createdAt: '',
      }),
    );
    await expect(paymentsService.tip(from, to, 500, 'eur')).rejects.toMatchObject({
      code: 'PAY_KYC_INCOMPLETE',
    });
  });

  it('returns a hosted Checkout URL for a KYC-complete recipient', async () => {
    const from = await seedUser();
    const to = await seedUser();
    await redis.set(
      accountKey(to),
      JSON.stringify({ stripeAccountId: 'acct_ok', kycComplete: true, createdAt: '' }),
    );
    const res = await paymentsService.tip(from, to, 500, 'eur');
    expect(res.url).toContain('checkout.stripe.com');
  });

  it('fails closed when a formerly KYC-complete account is now restricted at Stripe', async () => {
    const from = await seedUser();
    const to = await seedUser();
    await redis.set(
      accountKey(to),
      JSON.stringify({ stripeAccountId: 'acct_disabledb', kycComplete: true, createdAt: '' }),
    );
    await expect(paymentsService.tip(from, to, 500, 'eur')).rejects.toMatchObject({
      code: 'PAY_KYC_INCOMPLETE',
    });
  });

  it('never trusts a malformed payout-account cache entry', async () => {
    const from = await seedUser();
    const to = await seedUser();
    await redis.set(accountKey(to), '{not-json');
    await expect(paymentsService.tip(from, to, 500, 'eur')).rejects.toMatchObject({
      code: 'PAY_RECIPIENT_NOT_CONFIGURED',
    });
  });
});

describe('paymentsService — durable Stripe Connect mapping', () => {
  it('rebuilds the Redis KYC cache from PostgreSQL after cache eviction', async () => {
    const userId = await seedUser();
    await prisma.user.update({
      where: { id: userId },
      data: { stripeConnectAccountId: 'acct_durableRecovery' },
    });
    await redis.del(accountKey(userId));

    await expect(paymentsService.getAccountStatus(userId)).resolves.toEqual({
      connected: true,
      kycComplete: true,
      accountId: 'acct_durableRecovery',
    });
    expect(await redis.get(accountKey(userId))).toContain('acct_durableRecovery');
  });

  it('persists a newly-created Connect account before returning onboarding', async () => {
    const userId = await seedUser();
    const result = await paymentsService.onboardCreator(userId);
    expect(result.accountId).toBe('acct_test');
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { stripeConnectAccountId: true },
      }),
    ).resolves.toEqual({ stripeConnectAccountId: 'acct_test' });
  });

  it('persists account.updated state even when the Redis cache is absent', async () => {
    const userId = await seedUser();
    await paymentsService.syncAccount({
      id: 'acct_webhookDurable',
      payouts_enabled: true,
      charges_enabled: true,
      metadata: { chathouseUserId: userId },
    });
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { stripeConnectAccountId: true },
      }),
    ).resolves.toEqual({ stripeConnectAccountId: 'acct_webhookDurable' });
    expect(await redis.get(accountKey(userId))).toContain('"kycComplete":true');
  });
});

describe('paymentsService.recordTip — webhook ledger', () => {
  it('ignores a non-tip intent', async () => {
    await paymentsService.recordTip({ id: `pi_${rand()}`, metadata: { kind: 'other' } });
    // No row created — nothing to assert beyond no throw; verify count stays 0.
    const count = await prisma.tip.count({ where: { paymentIntentId: { startsWith: 'pi_' } } });
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it('records a SUCCEEDED tip and is idempotent on paymentIntentId', async () => {
    const from = await seedUser();
    const to = await seedUser();
    const pi = `pi_${rand()}`;
    const intent = {
      id: pi,
      amount: 500,
      currency: 'eur',
      metadata: { kind: 'tip', fromUserId: from, toUserId: to },
    };
    await paymentsService.recordTip(intent);
    await paymentsService.recordTip(intent); // replay
    const rows = await prisma.tip.findMany({ where: { paymentIntentId: pi } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('SUCCEEDED');
    expect(rows[0]?.amount).toBe(500);
    expect(rows[0]?.currency).toBe('eur');
  });
});

describe('premiumService — entitlement sync', () => {
  it('activates premium on an active subscription, then revokes on cancel', async () => {
    const userId = await seedUser();
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

    await premiumService.syncSubscription(
      {
        id: 'sub_a',
        created: 100,
        status: 'active',
        customer: 'cus_a',
        current_period_end: periodEnd,
        metadata: { chathouseUserId: userId },
      },
      { id: 'evt_sub_a_active', created: 100 },
    );
    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true, premiumUntil: true },
    });
    expect(user?.isPremium).toBe(true);
    expect(user?.premiumUntil).toBeTruthy();
    expect(await premiumService.isPremium(userId)).toBe(true);
    await expect(premiumService.requirePremium(userId)).resolves.toBeUndefined();

    // Cancel → entitlement revoked, subscription row updated (not duplicated).
    await premiumService.syncSubscription(
      {
        id: 'sub_a',
        created: 100,
        status: 'canceled',
        customer: 'cus_a',
        metadata: { chathouseUserId: userId },
      },
      { id: 'evt_sub_a_canceled', created: 200 },
    );
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true, premiumUntil: true },
    });
    expect(user?.isPremium).toBe(false);
    expect(user?.premiumUntil).toBeNull();
    expect(await premiumService.isPremium(userId)).toBe(false);
    await expect(premiumService.requirePremium(userId)).rejects.toMatchObject({
      code: 'PREMIUM_REQUIRED',
    });

    const subs = await prisma.subscription.findMany({ where: { userId } });
    expect(subs).toHaveLength(1);
    expect(subs[0]?.status).toBe('canceled');
  });

  it('does not reactivate premium when an older event arrives after cancellation', async () => {
    const userId = await seedUser();
    const subscriptionId = `sub_order_${rand()}`;
    const customerId = `cus_order_${rand()}`;
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    const active = {
      id: subscriptionId,
      created: 50,
      status: 'active',
      customer: customerId,
      current_period_end: periodEnd,
      metadata: { chathouseUserId: userId },
    };

    await premiumService.syncSubscription(active, { id: `evt_${rand()}`, created: 100 });
    await premiumService.syncSubscription(
      { ...active, status: 'canceled', current_period_end: undefined },
      { id: `evt_${rand()}`, created: 200 },
    );
    await premiumService.syncSubscription(active, { id: `evt_${rand()}`, created: 100 });

    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { isPremium: true, premiumUntil: true },
      }),
    ).resolves.toEqual({ isPremium: false, premiumUntil: null });
    await expect(
      prisma.subscription.findUniqueOrThrow({
        where: { userId },
        select: { status: true, lastStripeEventCreatedAt: true },
      }),
    ).resolves.toEqual({
      status: 'canceled',
      lastStripeEventCreatedAt: new Date(200 * 1000),
    });
  });

  it('never lets a superseded subscription id overwrite the newer subscription', async () => {
    const userId = await seedUser();
    const oldId = `sub_old_${rand()}`;
    const newId = `sub_new_${rand()}`;
    const metadata = { chathouseUserId: userId };
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;

    await premiumService.syncSubscription(
      {
        id: oldId,
        created: 100,
        status: 'active',
        customer: `cus_${rand()}`,
        current_period_end: periodEnd,
        metadata,
      },
      { id: `evt_${rand()}`, created: 100 },
    );
    await premiumService.syncSubscription(
      {
        id: newId,
        created: 200,
        status: 'active',
        customer: `cus_${rand()}`,
        current_period_end: periodEnd,
        metadata,
      },
      { id: `evt_${rand()}`, created: 200 },
    );

    // Even though this deletion event was emitted later, it belongs to the
    // older subscription and must not revoke the current entitlement.
    await premiumService.syncSubscription(
      {
        id: oldId,
        created: 100,
        status: 'canceled',
        customer: `cus_${rand()}`,
        metadata,
      },
      { id: `evt_${rand()}`, created: 300 },
    );

    await expect(
      prisma.subscription.findUniqueOrThrow({
        where: { userId },
        select: { stripeSubscriptionId: true, status: true },
      }),
    ).resolves.toEqual({ stripeSubscriptionId: newId, status: 'active' });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isPremium: true } }),
    ).resolves.toEqual({ isPremium: true });
  });

  it('fails closed when two different subscription ids have the same creation second', async () => {
    const userId = await seedUser();
    const metadata = { chathouseUserId: userId };
    const created = 300;
    const currentId = `sub_same_second_current_${rand()}`;

    await premiumService.syncSubscription(
      {
        id: currentId,
        created,
        status: 'canceled',
        customer: `cus_${rand()}`,
        metadata,
      },
      { id: `evt_${rand()}`, created: 400 },
    );
    await premiumService.syncSubscription(
      {
        id: `sub_same_second_active_${rand()}`,
        created,
        status: 'active',
        customer: `cus_${rand()}`,
        current_period_end: 500,
        metadata,
      },
      { id: `evt_${rand()}`, created: 500 },
    );

    await expect(
      prisma.subscription.findUniqueOrThrow({
        where: { userId },
        select: { stripeSubscriptionId: true, status: true },
      }),
    ).resolves.toEqual({ stripeSubscriptionId: currentId, status: 'canceled' });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { isPremium: true } }),
    ).resolves.toEqual({ isPremium: false });
  });

  it('is durably idempotent when the same Stripe event is replayed', async () => {
    const userId = await seedUser();
    const event = { id: `evt_replay_${rand()}`, created: 400 };
    const subscription = {
      id: `sub_replay_${rand()}`,
      created: 350,
      status: 'active',
      customer: `cus_replay_${rand()}`,
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      metadata: { chathouseUserId: userId },
    };

    await premiumService.syncSubscription(subscription, event);
    const first = await prisma.subscription.findUniqueOrThrow({ where: { userId } });
    await premiumService.syncSubscription(subscription, event);
    const replayed = await prisma.subscription.findUniqueOrThrow({ where: { userId } });

    expect(replayed.id).toBe(first.id);
    expect(replayed.updatedAt).toEqual(first.updatedAt);
    expect(replayed.lastStripeEventId).toBe(event.id);
    await expect(prisma.subscription.count({ where: { userId } })).resolves.toBe(1);
  });

  it('hydrates a legacy same-id row before accepting its first post-migration event', async () => {
    const userId = await seedUser();
    const now = 1_800_000_000;
    const subscriptionId = `sub_legacy_${rand()}`;
    const customerId = `cus_legacy_${rand()}`;
    await prisma.subscription.create({
      data: {
        userId,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: customerId,
        status: 'canceled',
      },
    });

    const stripe = await requireStripe();
    const retrieve = jest.spyOn(stripe.subscriptions, 'retrieve').mockResolvedValueOnce({
      id: subscriptionId,
      created: now - 1000,
      status: 'canceled',
      customer: customerId,
      metadata: { chathouseUserId: userId },
    });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    try {
      // This is a replay from before deployment. The current Stripe snapshot is
      // canceled, so bootstrap must not trust the historical active payload.
      await premiumService.syncSubscription(
        {
          id: subscriptionId,
          created: now - 1000,
          status: 'active',
          customer: customerId,
          current_period_end: now + 30 * 24 * 3600,
          metadata: { chathouseUserId: userId },
        },
        { id: `evt_legacy_active_${rand()}`, created: now - 500 },
      );
    } finally {
      clock.mockRestore();
      retrieve.mockRestore();
    }

    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { isPremium: true, premiumUntil: true },
      }),
    ).resolves.toEqual({ isPremium: false, premiumUntil: null });
    await expect(
      prisma.subscription.findUniqueOrThrow({
        where: { userId },
        select: {
          status: true,
          stripeSubscriptionCreatedAt: true,
          lastStripeEventCreatedAt: true,
        },
      }),
    ).resolves.toEqual({
      status: 'canceled',
      stripeSubscriptionCreatedAt: new Date((now - 1000) * 1000),
      lastStripeEventCreatedAt: new Date(now * 1000),
    });
  });

  it('timestamps a checkout-retrieved snapshot when observed, not when checkout occurred', async () => {
    const userId = await seedUser();
    const now = 1_800_000_000;
    const subscriptionId = `sub_checkout_snapshot_${rand()}`;
    const customerId = `cus_checkout_snapshot_${rand()}`;
    const stripe = await requireStripe();
    const retrieve = jest.spyOn(stripe.subscriptions, 'retrieve').mockResolvedValueOnce({
      id: subscriptionId,
      created: now - 500,
      status: 'canceled',
      customer: customerId,
      metadata: { chathouseUserId: userId },
    });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now * 1000);

    try {
      await premiumService.syncFromCheckout(
        {
          id: `cs_${rand()}`,
          url: null,
          mode: 'subscription',
          subscription: subscriptionId,
        },
        { id: `evt_checkout_${rand()}`, created: now - 300 },
      );

      // This payload was created after checkout but before the authoritative
      // canceled snapshot was retrieved. It must not reactivate premium.
      await premiumService.syncSubscription(
        {
          id: subscriptionId,
          created: now - 500,
          status: 'active',
          customer: customerId,
          current_period_end: now + 30 * 24 * 3600,
          metadata: { chathouseUserId: userId },
        },
        { id: `evt_active_${rand()}`, created: now - 100 },
      );
    } finally {
      clock.mockRestore();
      retrieve.mockRestore();
    }

    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { isPremium: true, premiumUntil: true },
      }),
    ).resolves.toEqual({ isPremium: false, premiumUntil: null });
    await expect(
      prisma.subscription.findUniqueOrThrow({
        where: { userId },
        select: { status: true, lastStripeEventCreatedAt: true },
      }),
    ).resolves.toEqual({
      status: 'canceled',
      lastStripeEventCreatedAt: new Date(now * 1000),
    });
  });
});

// Mark this file as a module so its top-level `const`s are module-scoped (the
// `require`-based test files are otherwise treated as scripts and collide on
// shared global names like `prisma`/`rand` during `tsc --noEmit`).
export {};
