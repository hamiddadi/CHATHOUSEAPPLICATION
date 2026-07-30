const inlineServiceAccount = JSON.stringify({
  type: 'service_account',
  project_id: 'chathouse-prod',
  private_key: '-----BEGIN PRIVATE KEY-----\nredacted\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-admin@chathouse-prod.iam.gserviceaccount.com',
});

const validProductionEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
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
  ANDROID_APP_SIGNING_SHA256: Array.from({ length: 32 }, () => 'CD').join(':'),
  DATABASE_URL: 'postgresql://user:password@db.example.com:5432/chathouse',
  REDIS_URL: 'redis://redis.example.com:6379',
  JWT_ACCESS_SECRET: 'production-access-secret-that-is-long-enough',
  JWT_REFRESH_SECRET: 'production-refresh-secret-that-is-long-enough',
  PUBLIC_URL: 'https://api.chathouse.test',
  MEDIA_STORAGE_DRIVER: 's3',
  MEDIA_URL_SIGNING_SECRET: 'production-media-secret-that-is-long-enough',
  MEDIA_S3_BUCKET: 'private-media',
  LIVEKIT_URL: 'wss://chathouse-test.livekit.cloud',
  LIVEKIT_API_KEY: 'production-livekit-key',
  LIVEKIT_API_SECRET: 'production-livekit-secret-that-is-long-enough',
  TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'production-twilio-auth-token',
  TWILIO_FROM_NUMBER: '+15551234567',
  RESEND_API_KEY: 're_production_api_key',
  MAIL_FROM: 'no-reply@chathouse.test',
  PUSH_DISPATCH_ENABLED: 'true',
});

describe('production push environment', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
    jest.resetModules();
  });

  const expectBootRejection = async (): Promise<string> => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null): never => {
      throw new Error(`process.exit:${String(code)}`);
    });

    await expect(import('../src/config/env')).rejects.toThrow('process.exit:1');
    return JSON.stringify(consoleError.mock.calls);
  };

  it('requires dispatch and one explicit Firebase credential mode', async () => {
    process.env = {
      ...validProductionEnv(),
      PUSH_DISPATCH_ENABLED: 'false',
    };

    const output = await expectBootRejection();

    expect(output).toContain('PUSH_DISPATCH_ENABLED must be true in production');
    expect(output).toContain('set FIREBASE_SERVICE_ACCOUNT or explicitly enable FIREBASE_USE_ADC');
  });

  it('rejects malformed inline service-account JSON before boot', async () => {
    process.env = {
      ...validProductionEnv(),
      FIREBASE_SERVICE_ACCOUNT: '{not-json}',
    };

    const output = await expectBootRejection();

    expect(output).toContain('FIREBASE_SERVICE_ACCOUNT must be valid JSON');
  });

  it('rejects ambiguous inline and ADC credential modes', async () => {
    process.env = {
      ...validProductionEnv(),
      FIREBASE_SERVICE_ACCOUNT: inlineServiceAccount,
      FIREBASE_USE_ADC: 'true',
    };

    const output = await expectBootRejection();

    expect(output).toContain(
      'FIREBASE_SERVICE_ACCOUNT and FIREBASE_USE_ADC are mutually exclusive',
    );
  });

  it('rejects placeholder legal identity', async () => {
    process.env = {
      ...validProductionEnv(),
      FIREBASE_USE_ADC: 'true',
      LEGAL_ENTITY_NAME: '__CHANGE_ME__',
      LEGAL_PROCESSING_LOCATIONS: 'Pending confirmation',
    };

    const output = await expectBootRejection();

    expect(output).toContain('LEGAL_ENTITY_NAME');
    expect(output).toContain('LEGAL_PROCESSING_LOCATIONS');
  });

  it('rejects malformed production signing identifiers', async () => {
    process.env = {
      ...validProductionEnv(),
      FIREBASE_USE_ADC: 'true',
      APPLE_TEAM_ID: '__CHANGE_ME__',
      ANDROID_APP_SIGNING_SHA256: '__CHANGE_ME__',
    };

    const output = await expectBootRejection();

    expect(output).toContain('APPLE_TEAM_ID');
    expect(output).toContain('ANDROID_APP_SIGNING_SHA256');
  });

  it('accepts a structurally valid inline service account', async () => {
    process.env = {
      ...validProductionEnv(),
      FIREBASE_SERVICE_ACCOUNT: inlineServiceAccount,
    };

    const { env } = await import('../src/config/env');

    expect(env.PUSH_DISPATCH_ENABLED).toBe(true);
    expect(env.FIREBASE_SERVICE_ACCOUNT).toBe(inlineServiceAccount);
    expect(env.FIREBASE_USE_ADC).toBe(false);
  });

  it('accepts explicitly selected ADC without an inline secret', async () => {
    process.env = {
      ...validProductionEnv(),
      FIREBASE_USE_ADC: 'true',
    };

    const { env } = await import('../src/config/env');

    expect(env.PUSH_DISPATCH_ENABLED).toBe(true);
    expect(env.FIREBASE_SERVICE_ACCOUNT).toBeUndefined();
    expect(env.FIREBASE_USE_ADC).toBe(true);
  });
});
