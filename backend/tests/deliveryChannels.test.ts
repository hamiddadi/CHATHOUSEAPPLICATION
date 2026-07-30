interface DeliveryEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
}

const productionEnv: DeliveryEnv = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'info',
  TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'twilio-auth-token-for-unit-tests',
  TWILIO_FROM_NUMBER: '+15551234567',
  RESEND_API_KEY: 're_unit_test_api_key',
  MAIL_FROM: 'no-reply@chathouse.test',
};

const legalProductionEnv: NodeJS.ProcessEnv = {
  LEGAL_ENTITY_NAME: 'ChatHouse Test Operator',
  LEGAL_REGISTERED_ADDRESS: '1 Release Test Street',
  LEGAL_REGISTRATION_NUMBER: 'TEST-123',
  LEGAL_JURISDICTION: 'Test jurisdiction',
  LEGAL_DISPUTE_PROCESS: 'Test courts and dispute process',
  LEGAL_LIABILITY_TERMS: 'Test liability cap with mandatory-law carve-outs',
  LEGAL_SUPERVISORY_AUTHORITY: 'Test Data Protection Authority',
  LEGAL_TRANSFER_SAFEGUARDS: 'Standard contractual clauses for release tests',
  LEGAL_DPO_CONTACT: 'Not appointed',
  LEGAL_EU_REPRESENTATIVE: 'Not applicable',
  LEGAL_DOCUMENT_VERSION: '2026-07-29',
  LEGAL_DOCUMENT_EFFECTIVE_DATE: '2026-07-29',
  LEGAL_SERVICE_PROVIDERS: 'Example hosting and messaging processors for release tests',
  LEGAL_PROCESSING_LOCATIONS: 'Test region',
  LEGAL_LOG_BACKUP_RETENTION: 'Thirty days in release tests',
  LEGAL_SUPPORT_MODERATION_RETENTION: 'Ninety days in release tests',
  LEGAL_MODERATION_APPEAL_ROUTE: 'Email the monitored safety team',
  LEGAL_ADULT_CONTENT_POLICY: 'Prohibited in release tests',
  LEGAL_CHILD_SAFETY_REPORTING_PROCESS: 'Escalate to the competent test authority',
  LEGAL_CONTACT_PHONE: '+15551234567',
  PRIVACY_CONTACT_EMAIL: 'privacy@chathouse.test',
  SUPPORT_CONTACT_EMAIL: 'support@chathouse.test',
  SAFETY_CONTACT_EMAIL: 'safety@chathouse.test',
  CHILD_SAFETY_CONTACT_NAME: 'Release Test Safety Lead',
  CHILD_SAFETY_CONTACT_EMAIL: 'child-safety@chathouse.test',
  APPLE_TEAM_ID: 'A1B2C3D4E5',
  ANDROID_APP_SIGNING_SHA256: Array.from({ length: 32 }, () => 'AB').join(':'),
};

const loadMailer = (mockEnv: DeliveryEnv) => {
  jest.resetModules();
  const info = jest.fn();
  jest.doMock('../src/config/env', () => ({ env: mockEnv }));
  jest.doMock('../src/config/logger', () => ({ logger: { info } }));

  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const mailer = require('../src/config/mailer') as typeof import('../src/config/mailer');
  return { mailer, info };
};

const loadSmsSender = (mockEnv: DeliveryEnv) => {
  jest.resetModules();
  const info = jest.fn();
  const warn = jest.fn();
  jest.doMock('../src/config/env', () => ({ env: mockEnv }));
  jest.doMock('../src/config/logger', () => ({ logger: { info, warn } }));

  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const smsSender = require('../src/config/smsSender') as typeof import('../src/config/smsSender');
  return { smsSender, info, warn };
};

describe('delivery channels', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
    jest.dontMock('../src/config/env');
    jest.dontMock('../src/config/logger');
    jest.dontMock('twilio');
  });

  it('keeps email non-delivering outside production without logging the body or token', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { mailer, info } = loadMailer({
      NODE_ENV: 'test',
      LOG_LEVEL: 'info',
    });
    const resetToken = 'secret-reset-token-that-must-never-reach-logs';

    await mailer.sendMail({
      to: 'member@example.com',
      subject: 'Reset password',
      text: `Use token ${resetToken}`,
      html: `<p>Use token ${resetToken}</p>`,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('[mail-stub] external delivery skipped', {
      to: 'member@example.com',
      subject: 'Reset password',
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain(resetToken);
  });

  it('sends production email through Resend and logs only the provider message id', async () => {
    const fetchMock = jest.fn(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_123' }),
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { mailer, info } = loadMailer(productionEnv);

    await mailer.sendMail({
      to: 'member@example.com',
      subject: 'Reset password',
      text: 'private reset token',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${productionEnv.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: productionEnv.MAIL_FROM,
          to: ['member@example.com'],
          subject: 'Reset password',
          text: 'private reset token',
        }),
      }),
    );
    expect(info).toHaveBeenCalledWith('[mail] accepted by provider', {
      messageId: 'email_123',
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('private reset token');
    expect(JSON.stringify(info.mock.calls)).not.toContain(productionEnv.RESEND_API_KEY);
  });

  it('fails closed when production email configuration is absent', async () => {
    const { mailer } = loadMailer({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    });

    await expect(
      mailer.sendMail({
        to: 'member@example.com',
        subject: 'Reset password',
        text: 'private reset token',
      }),
    ).rejects.toThrow('Email delivery is not configured');
  });

  it('fails closed on a provider rejection without exposing its response body', async () => {
    const providerBody = 'provider echoed private reset token';
    const fetchMock = jest.fn(async () => {
      return {
        ok: false,
        status: 422,
        json: async () => ({ message: providerBody }),
      } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { mailer, info } = loadMailer(productionEnv);

    await expect(
      mailer.sendMail({
        to: 'member@example.com',
        subject: 'Reset password',
        text: 'private reset token',
      }),
    ).rejects.toThrow('Email provider rejected the request (HTTP 422)');
    expect(JSON.stringify(info.mock.calls)).not.toContain(providerBody);
  });

  it('fails closed when production SMS configuration is absent', async () => {
    const { smsSender } = loadSmsSender({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
    });

    await expect(
      smsSender.sendSms({ to: '+15557654321', body: 'Your code: 123456' }),
    ).rejects.toThrow('SMS delivery is not configured');
  });

  it('fails closed when the Twilio client cannot initialize in production', async () => {
    jest.doMock('twilio', () => {
      throw new Error('simulated module initialization failure');
    });
    const { smsSender } = loadSmsSender(productionEnv);

    await expect(
      smsSender.sendSms({ to: '+15557654321', body: 'Your code: 123456' }),
    ).rejects.toThrow('SMS provider client initialization failed');
  });

  it('awaits Twilio delivery with the configured sender in production', async () => {
    const create = jest.fn(async () => ({ sid: 'SM123' }));
    jest.doMock('twilio', () => jest.fn(() => ({ messages: { create } })));
    const { smsSender } = loadSmsSender(productionEnv);

    await smsSender.sendSms({ to: '+15557654321', body: 'Your code: 123456' });

    expect(create).toHaveBeenCalledWith({
      to: '+15557654321',
      from: '+15551234567',
      body: 'Your code: 123456',
    });
  });

  it('sanitizes Twilio failures before logging or propagating them', async () => {
    const providerMessage = 'Could not send to +15557654321: Your code: 123456';
    const create = jest.fn(async () => {
      throw Object.assign(new Error(providerMessage), { code: 21614, status: 400 });
    });
    jest.doMock('twilio', () => jest.fn(() => ({ messages: { create } })));
    const { smsSender, warn } = loadSmsSender(productionEnv);

    await expect(
      smsSender.sendSms({ to: '+15557654321', body: 'Your code: 123456' }),
    ).rejects.toThrow('SMS provider request failed');

    expect(warn).toHaveBeenCalledWith('[sms] provider request failed', {
      providerCode: 21614,
      providerStatus: 400,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('+15557654321');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('123456');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(providerMessage);
  });
});

describe('production delivery configuration at boot', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('rejects startup when any required SMS or email setting is absent', async () => {
    process.env = {
      ...originalEnv,
      ...legalProductionEnv,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:password@db.example.com:5432/chathouse',
      REDIS_URL: 'redis://redis.example.com:6379',
      JWT_ACCESS_SECRET: 'production-access-secret-that-is-long-enough',
      JWT_REFRESH_SECRET: 'production-refresh-secret-that-is-long-enough',
      PUBLIC_URL: 'https://api.chathouse.test',
      MEDIA_STORAGE_DRIVER: 's3',
      MEDIA_URL_SIGNING_SECRET: 'production-media-secret-that-is-long-enough',
      MEDIA_S3_BUCKET: 'private-media',
    };
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_NUMBER;
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
      throw new Error(`process.exit:${String(code)}`);
    });

    await expect(import('../src/config/env')).rejects.toThrow('process.exit:1');

    const validationOutput = JSON.stringify(consoleError.mock.calls);
    expect(validationOutput).toContain('TWILIO_ACCOUNT_SID is required in production');
    expect(validationOutput).toContain('TWILIO_AUTH_TOKEN is required in production');
    expect(validationOutput).toContain('TWILIO_FROM_NUMBER is required in production');
    expect(validationOutput).toContain('RESEND_API_KEY is required in production');
    expect(validationOutput).toContain('MAIL_FROM is required in production');
  });

  it('rejects the documented Resend placeholder in production', async () => {
    process.env = {
      ...originalEnv,
      ...legalProductionEnv,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:password@db.example.com:5432/chathouse',
      REDIS_URL: 'redis://redis.example.com:6379',
      JWT_ACCESS_SECRET: 'production-access-secret-that-is-long-enough',
      JWT_REFRESH_SECRET: 'production-refresh-secret-that-is-long-enough',
      PUBLIC_URL: 'https://api.chathouse.test',
      MEDIA_STORAGE_DRIVER: 's3',
      MEDIA_URL_SIGNING_SECRET: 'production-media-secret-that-is-long-enough',
      MEDIA_S3_BUCKET: 'private-media',
      LIVEKIT_API_KEY: 'production-livekit-key',
      LIVEKIT_API_SECRET: 'production-livekit-secret-that-is-long-enough',
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_AUTH_TOKEN: 'production-twilio-auth-token',
      TWILIO_FROM_NUMBER: '+15551234567',
      RESEND_API_KEY: 're___CHANGE_ME__',
      MAIL_FROM: 'no-reply@chathouse.test',
      PUSH_DISPATCH_ENABLED: 'true',
      FIREBASE_USE_ADC: 'true',
    };

    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
      throw new Error(`process.exit:${String(code)}`);
    });

    await expect(import('../src/config/env')).rejects.toThrow('process.exit:1');
    expect(JSON.stringify(consoleError.mock.calls)).toContain('RESEND_API_KEY');
  });
});
