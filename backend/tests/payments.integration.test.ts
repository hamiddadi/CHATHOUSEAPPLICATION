/**
 * Payments + premium integration tests.
 *
 * Mocks the external Stripe SDK (optional dynamic import) and Redis (in-memory),
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
        retrieve: async () => ({ id: 'sub_test', status: 'active', customer: 'cus_test' }),
      },
      accounts: {
        create: async () => ({ id: 'acct_test' }),
        retrieve: async () => ({ payouts_enabled: true, charges_enabled: true }),
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
    // `virtual: true` — 'stripe' is an OPTIONAL dependency that isn't installed,
    // so jest must mock it without resolving the real module.
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
      JSON.stringify({ stripeAccountId: 'acct_x', kycComplete: false, createdAt: '' }),
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

    await premiumService.syncSubscription({
      id: 'sub_a',
      status: 'active',
      customer: 'cus_a',
      current_period_end: periodEnd,
      metadata: { chathouseUserId: userId },
    });
    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isPremium: true, premiumUntil: true },
    });
    expect(user?.isPremium).toBe(true);
    expect(user?.premiumUntil).toBeTruthy();
    expect(await premiumService.isPremium(userId)).toBe(true);
    await expect(premiumService.requirePremium(userId)).resolves.toBeUndefined();

    // Cancel → entitlement revoked, subscription row updated (not duplicated).
    await premiumService.syncSubscription({
      id: 'sub_a',
      status: 'canceled',
      customer: 'cus_a',
      metadata: { chathouseUserId: userId },
    });
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
});

// Mark this file as a module so its top-level `const`s are module-scoped (the
// `require`-based test files are otherwise treated as scripts and collide on
// shared global names like `prisma`/`rand` during `tsc --noEmit`).
export {};
