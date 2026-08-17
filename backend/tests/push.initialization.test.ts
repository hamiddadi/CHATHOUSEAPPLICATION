interface PushEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PUSH_DISPATCH_ENABLED: boolean;
  FIREBASE_SERVICE_ACCOUNT?: string;
  FIREBASE_USE_ADC: boolean;
}

const serviceAccount = JSON.stringify({
  type: 'service_account',
  project_id: 'chathouse-test',
  private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
  client_email: 'firebase-admin@chathouse-test.iam.gserviceaccount.com',
});

const loadPushService = (
  mockEnv: PushEnv,
  options: {
    initializeError?: Error;
    apps?: object[];
    accessTokenError?: Error;
    accessTokenPromise?: Promise<{ access_token: string; expires_in: number }>;
  } = {},
) => {
  jest.resetModules();
  const getAccessToken = jest.fn(() => {
    if (options.accessTokenError) return Promise.reject(options.accessTokenError);
    return (
      options.accessTokenPromise ??
      Promise.resolve({ access_token: 'test-oauth-access-token', expires_in: 3600 })
    );
  });
  const credentialFromJson = { source: 'json', getAccessToken };
  const credentialFromAdc = { source: 'adc', getAccessToken };
  const messaging = { sendEachForMulticast: jest.fn() };
  const cert = jest.fn(() => credentialFromJson);
  const applicationDefault = jest.fn(() => credentialFromAdc);
  const initializeApp = jest.fn(() => {
    if (options.initializeError) throw options.initializeError;
    return {};
  });
  const getMessaging = jest.fn(() => messaging);
  const error = jest.fn();

  jest.doMock('../src/config/env', () => ({ env: mockEnv }));
  jest.doMock('../src/config/logger', () => ({
    logger: { error, info: jest.fn(), warn: jest.fn() },
  }));
  jest.doMock('../src/config/database', () => ({
    prisma: {
      pushToken: {
        findMany: jest.fn(async () => []),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    },
  }));
  jest.doMock('firebase-admin', () => ({
    applicationDefault,
    cert,
    getApps: jest.fn(() => options.apps ?? []),
    initializeApp,
  }));
  jest.doMock('firebase-admin/messaging', () => ({ getMessaging }));

  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const module =
    require('../src/modules/push/push.service') as typeof import('../src/modules/push/push.service');
  return {
    ...module,
    applicationDefault,
    cert,
    credentialFromAdc,
    credentialFromJson,
    error,
    getAccessToken,
    getMessaging,
    initializeApp,
  };
};

describe('push Firebase initialization', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../src/config/env');
    jest.dontMock('../src/config/logger');
    jest.dontMock('../src/config/database');
    jest.dontMock('firebase-admin');
    jest.dontMock('firebase-admin/messaging');
  });

  it('keeps the non-delivering stub outside production when dispatch is disabled', async () => {
    const loaded = loadPushService({
      NODE_ENV: 'test',
      PUSH_DISPATCH_ENABLED: false,
      FIREBASE_USE_ADC: false,
    });

    await expect(loaded.initializePush()).resolves.toBeUndefined();
    expect(loaded.initializeApp).not.toHaveBeenCalled();
    expect(loaded.getMessaging).not.toHaveBeenCalled();
  });

  it('initializes Firebase from a validated inline service account and probes it in production', async () => {
    const loaded = loadPushService({
      NODE_ENV: 'production',
      PUSH_DISPATCH_ENABLED: true,
      FIREBASE_SERVICE_ACCOUNT: serviceAccount,
      FIREBASE_USE_ADC: false,
    });

    await loaded.initializePush();

    expect(loaded.cert).toHaveBeenCalledWith(JSON.parse(serviceAccount));
    expect(loaded.initializeApp).toHaveBeenCalledWith({
      credential: loaded.credentialFromJson,
    });
    expect(loaded.getMessaging).toHaveBeenCalledTimes(1);
    expect(loaded.getAccessToken).toHaveBeenCalledTimes(1);
  });

  it('uses and probes ADC only when that credential mode is explicitly enabled', async () => {
    const loaded = loadPushService({
      NODE_ENV: 'production',
      PUSH_DISPATCH_ENABLED: true,
      FIREBASE_USE_ADC: true,
    });

    await loaded.initializePush();

    expect(loaded.applicationDefault).toHaveBeenCalledTimes(1);
    expect(loaded.initializeApp).toHaveBeenCalledWith({
      credential: loaded.credentialFromAdc,
    });
    expect(loaded.cert).not.toHaveBeenCalled();
    expect(loaded.getAccessToken).toHaveBeenCalledTimes(1);
  });

  it('propagates Firebase initialization failures without logging provider details', async () => {
    const loaded = loadPushService(
      {
        NODE_ENV: 'production',
        PUSH_DISPATCH_ENABLED: true,
        FIREBASE_SERVICE_ACCOUNT: serviceAccount,
        FIREBASE_USE_ADC: false,
      },
      { initializeError: new Error('invalid credential') },
    );

    await expect(loaded.initializePush()).rejects.toThrow('Push delivery initialization failed');
    expect(loaded.error).toHaveBeenCalledWith('push: firebase-admin init failed', {
      credentialMode: 'inline_service_account',
    });
    expect(JSON.stringify(loaded.error.mock.calls)).not.toContain('invalid credential');
  });

  it('refuses an enabled dispatcher with no explicit credential mode', async () => {
    const loaded = loadPushService({
      NODE_ENV: 'development',
      PUSH_DISPATCH_ENABLED: true,
      FIREBASE_USE_ADC: false,
    });

    await expect(loaded.initializePush()).rejects.toThrow('Push delivery initialization failed');
    expect(loaded.error).toHaveBeenCalledWith('push: firebase-admin init failed', {
      credentialMode: 'missing',
    });
  });

  it('rejects a production Firebase app whose credential cannot be probed', async () => {
    const loaded = loadPushService(
      {
        NODE_ENV: 'production',
        PUSH_DISPATCH_ENABLED: true,
        FIREBASE_USE_ADC: true,
      },
      { apps: [{}] },
    );

    await expect(loaded.initializePush()).rejects.toThrow('Push delivery initialization failed');
    expect(loaded.error).toHaveBeenCalledWith('push: firebase-admin init failed', {
      credentialMode: 'existing_app',
    });
  });

  it('rejects unusable ADC credentials at boot without logging provider details', async () => {
    const loaded = loadPushService(
      {
        NODE_ENV: 'production',
        PUSH_DISPATCH_ENABLED: true,
        FIREBASE_USE_ADC: true,
      },
      { accessTokenError: new Error('metadata endpoint leaked-sensitive-detail') },
    );

    await expect(loaded.initializePush()).rejects.toThrow('Push delivery credential probe failed');
    expect(loaded.error).toHaveBeenCalledWith('push: Firebase credential probe failed', {
      credentialMode: 'adc',
      reason: 'rejected',
    });
    expect(JSON.stringify(loaded.error.mock.calls)).not.toContain('leaked-sensitive-detail');
  });

  it('bounds a stalled ADC credential probe with a startup timeout', async () => {
    jest.useFakeTimers();
    try {
      const loaded = loadPushService(
        {
          NODE_ENV: 'production',
          PUSH_DISPATCH_ENABLED: true,
          FIREBASE_USE_ADC: true,
        },
        {
          accessTokenPromise: new Promise<{ access_token: string; expires_in: number }>(
            () => undefined,
          ),
        },
      );

      const initialization = loaded.initializePush();
      const rejection = expect(initialization).rejects.toThrow(
        'Push delivery credential probe timed out',
      );
      await jest.advanceTimersByTimeAsync(loaded.PUSH_CREDENTIAL_PROBE_TIMEOUT_MS);

      await rejection;
      expect(loaded.error).toHaveBeenCalledWith('push: Firebase credential probe failed', {
        credentialMode: 'adc',
        reason: 'timeout',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('defends against a production dispatcher being disabled', async () => {
    const loaded = loadPushService({
      NODE_ENV: 'production',
      PUSH_DISPATCH_ENABLED: false,
      FIREBASE_USE_ADC: false,
    });

    await expect(loaded.initializePush()).rejects.toThrow(
      'Push delivery cannot be disabled in production',
    );
  });
});
