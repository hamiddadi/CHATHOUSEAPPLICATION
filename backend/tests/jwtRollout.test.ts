import jwt from 'jsonwebtoken';

const cutoff = '2099-01-01T00:00:00.000Z';
const cutoffMs = Date.parse(cutoff);
const originalCutoff = process.env.JWT_LEGACY_NO_ISS_AUD_ACCEPT_UNTIL;

const loadJwtUtils = async (configuredCutoff?: string) => {
  jest.resetModules();
  if (configuredCutoff === undefined) {
    delete process.env.JWT_LEGACY_NO_ISS_AUD_ACCEPT_UNTIL;
  } else {
    process.env.JWT_LEGACY_NO_ISS_AUD_ACCEPT_UNTIL = configuredCutoff;
  }
  return import('../src/utils/jwt');
};

const signLegacyAccessToken = (): string =>
  jwt.sign({ sub: 'legacy-access-user', typ: 'access', tv: 0 }, process.env.JWT_ACCESS_SECRET!, {
    algorithm: 'HS256',
    noTimestamp: true,
  });

const signLegacyRefreshToken = (): string =>
  jwt.sign(
    { sub: 'legacy-refresh-user', typ: 'refresh', jti: 'legacy-refresh-jti' },
    process.env.JWT_REFRESH_SECRET!,
    { algorithm: 'HS256', noTimestamp: true },
  );

describe('JWT issuer/audience rolling compatibility', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    if (originalCutoff === undefined) {
      delete process.env.JWT_LEGACY_NO_ISS_AUD_ACCEPT_UNTIL;
    } else {
      process.env.JWT_LEGACY_NO_ISS_AUD_ACCEPT_UNTIL = originalCutoff;
    }
  });

  it('uses strict verification by default when no cutoff is configured', async () => {
    const { verifyAccessToken, verifyRefreshToken } = await loadJwtUtils();

    expect(() => verifyAccessToken(signLegacyAccessToken())).toThrow();
    expect(() => verifyRefreshToken(signLegacyRefreshToken())).toThrow();
  });

  it('accepts legacy access and refresh tokens only when both claims are absent before cutoff', async () => {
    const { verifyAccessToken, verifyRefreshToken } = await loadJwtUtils(cutoff);
    jest.spyOn(Date, 'now').mockReturnValue(cutoffMs - 60_000);

    expect(verifyAccessToken(signLegacyAccessToken())).toMatchObject({
      sub: 'legacy-access-user',
      typ: 'access',
      tv: 0,
    });
    expect(verifyRefreshToken(signLegacyRefreshToken())).toMatchObject({
      sub: 'legacy-refresh-user',
      typ: 'refresh',
      jti: 'legacy-refresh-jti',
    });
  });

  it('rejects legacy access and refresh tokens at and after cutoff', async () => {
    const { verifyAccessToken, verifyRefreshToken } = await loadJwtUtils(cutoff);
    const accessToken = signLegacyAccessToken();
    const refreshToken = signLegacyRefreshToken();
    const now = jest.spyOn(Date, 'now').mockReturnValue(cutoffMs);

    expect(() => verifyAccessToken(accessToken)).toThrow();
    expect(() => verifyRefreshToken(refreshToken)).toThrow();

    now.mockReturnValue(cutoffMs + 60_000);
    expect(() => verifyAccessToken(accessToken)).toThrow();
    expect(() => verifyRefreshToken(refreshToken)).toThrow();
  });

  it('accepts newly issued HS256 access and refresh tokens after cutoff', async () => {
    const { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } =
      await loadJwtUtils(cutoff);
    jest.spyOn(Date, 'now').mockReturnValue(cutoffMs + 60_000);

    const accessToken = signAccessToken('strict-access-user', 4);
    const refreshToken = signRefreshToken('strict-refresh-user', 'strict-jti');
    expect(jwt.decode(accessToken, { complete: true })).toMatchObject({
      header: { alg: 'HS256' },
      payload: { iss: 'chathouse-api', aud: 'chathouse-app' },
    });
    expect(jwt.decode(refreshToken, { complete: true })).toMatchObject({
      header: { alg: 'HS256' },
      payload: { iss: 'chathouse-api', aud: 'chathouse-app' },
    });
    expect(verifyAccessToken(accessToken)).toMatchObject({
      sub: 'strict-access-user',
      typ: 'access',
      tv: 4,
    });
    expect(verifyRefreshToken(refreshToken)).toMatchObject({
      sub: 'strict-refresh-user',
      typ: 'refresh',
      jti: 'strict-jti',
    });
  });

  it('never downgrades access or refresh tokens carrying only one registered claim', async () => {
    const { verifyAccessToken, verifyRefreshToken } = await loadJwtUtils(cutoff);
    jest.spyOn(Date, 'now').mockReturnValue(cutoffMs - 60_000);
    const accessIssuerOnly = jwt.sign(
      { sub: 'u', typ: 'access', tv: 0, iss: 'chathouse-api' },
      process.env.JWT_ACCESS_SECRET!,
      { algorithm: 'HS256', noTimestamp: true },
    );
    const accessAudienceOnly = jwt.sign(
      { sub: 'u', typ: 'access', tv: 0, aud: 'chathouse-app' },
      process.env.JWT_ACCESS_SECRET!,
      { algorithm: 'HS256', noTimestamp: true },
    );
    const refreshIssuerOnly = jwt.sign(
      { sub: 'u', typ: 'refresh', jti: 'issuer-only', iss: 'chathouse-api' },
      process.env.JWT_REFRESH_SECRET!,
      { algorithm: 'HS256', noTimestamp: true },
    );
    const refreshAudienceOnly = jwt.sign(
      { sub: 'u', typ: 'refresh', jti: 'audience-only', aud: 'chathouse-app' },
      process.env.JWT_REFRESH_SECRET!,
      { algorithm: 'HS256', noTimestamp: true },
    );

    expect(() => verifyAccessToken(accessIssuerOnly)).toThrow();
    expect(() => verifyAccessToken(accessAudienceOnly)).toThrow();
    expect(() => verifyRefreshToken(refreshIssuerOnly)).toThrow();
    expect(() => verifyRefreshToken(refreshAudienceOnly)).toThrow();
  });

  it('rejects a claim-less legacy token that is not signed with HS256', async () => {
    const { verifyAccessToken } = await loadJwtUtils(cutoff);
    jest.spyOn(Date, 'now').mockReturnValue(cutoffMs - 60_000);
    const token = jwt.sign({ sub: 'u', typ: 'access', tv: 0 }, process.env.JWT_ACCESS_SECRET!, {
      algorithm: 'HS384',
      noTimestamp: true,
    });

    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('always rejects wrong issuer or audience for access and refresh tokens', async () => {
    const { verifyAccessToken, verifyRefreshToken } = await loadJwtUtils(cutoff);
    jest.spyOn(Date, 'now').mockReturnValue(cutoffMs - 60_000);
    const wrongAccess = jwt.sign(
      { sub: 'u', typ: 'access', tv: 0 },
      process.env.JWT_ACCESS_SECRET!,
      {
        algorithm: 'HS256',
        issuer: 'wrong-api',
        audience: 'chathouse-app',
        noTimestamp: true,
      },
    );
    const wrongRefresh = jwt.sign(
      { sub: 'u', typ: 'refresh', jti: 'wrong-claims-jti' },
      process.env.JWT_REFRESH_SECRET!,
      {
        algorithm: 'HS256',
        issuer: 'chathouse-api',
        audience: 'wrong-app',
        noTimestamp: true,
      },
    );

    expect(() => verifyAccessToken(wrongAccess)).toThrow();
    expect(() => verifyRefreshToken(wrongRefresh)).toThrow();
  });
});
