import jwt from 'jsonwebtoken';
import {
  decodeTokenTtl,
  signAccessToken,
  signImpersonationToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from '../src/utils/jwt';

describe('jwt utils', () => {
  it('signs and verifies an access token round-trip', () => {
    const token = signAccessToken('user-1');
    const claims = verifyAccessToken(token);
    const decoded = jwt.decode(token, { complete: true });

    expect(decoded?.header.alg).toBe('HS256');
    expect(decoded?.payload).toEqual(
      expect.objectContaining({ iss: 'chathouse-api', aud: 'chathouse-app' }),
    );
    expect(claims.sub).toBe('user-1');
    expect(claims.typ).toBe('access');
    expect(claims.jti).toEqual(expect.any(String));
  });

  it('mints a unique jti for every access token, even within one clock tick', () => {
    const tokens = Array.from({ length: 64 }, () => signAccessToken('user-1'));
    const jtis = tokens.map(token => verifyAccessToken(token).jti);

    expect(new Set(tokens).size).toBe(tokens.length);
    expect(jtis.every(jti => typeof jti === 'string')).toBe(true);
    expect(new Set(jtis).size).toBe(tokens.length);
  });

  it('mints a unique jti for impersonation access tokens', () => {
    const first = verifyAccessToken(signImpersonationToken('user-1', 'admin-1', 3, 7));
    const second = verifyAccessToken(signImpersonationToken('user-1', 'admin-1', 3, 7));

    expect(first.jti).toEqual(expect.any(String));
    expect(second.jti).not.toBe(first.jti);
    expect(first.tv).toBe(3);
    expect(first.act).toEqual({ sub: 'admin-1', tv: 7 });
  });

  it('still verifies a pre-rollout access token without jti', () => {
    const legacy = jwt.sign(
      { sub: 'legacy-user', typ: 'access', tv: 0 },
      process.env.JWT_ACCESS_SECRET!,
      {
        algorithm: 'HS256',
        issuer: 'chathouse-api',
        audience: 'chathouse-app',
        expiresIn: '5m',
      },
    );

    expect(verifyAccessToken(legacy)).toMatchObject({
      sub: 'legacy-user',
      typ: 'access',
      tv: 0,
    });
  });

  it('rejects a refresh token passed to the access verifier', () => {
    const refresh = signRefreshToken('user-1', 'jti-1');
    expect(() => verifyAccessToken(refresh)).toThrow();
  });

  it('signs and verifies a refresh token with jti', () => {
    const refresh = signRefreshToken('user-1', 'jti-abc');
    const claims = verifyRefreshToken(refresh);
    const decoded = jwt.decode(refresh, { complete: true });

    expect(decoded?.header.alg).toBe('HS256');
    expect(decoded?.payload).toEqual(
      expect.objectContaining({ iss: 'chathouse-api', aud: 'chathouse-app' }),
    );
    expect(claims.sub).toBe('user-1');
    expect(claims.jti).toBe('jti-abc');
    expect(claims.typ).toBe('refresh');
  });

  it('round-trips the signed account-recovery scope on both token kinds', () => {
    const access = verifyAccessToken(signAccessToken('user-1', 4, 'account_recovery'));
    const refresh = verifyRefreshToken(
      signRefreshToken('user-1', 'recovery-jti', 'account_recovery'),
    );

    expect(access).toMatchObject({
      sub: 'user-1',
      typ: 'access',
      tv: 4,
      scope: 'account_recovery',
    });
    expect(refresh).toMatchObject({
      sub: 'user-1',
      typ: 'refresh',
      jti: 'recovery-jti',
      scope: 'account_recovery',
    });
    expect(verifyAccessToken(signAccessToken('user-1')).scope).toBeUndefined();
    expect(verifyRefreshToken(signRefreshToken('user-1', 'active-jti')).scope).toBeUndefined();
  });

  it('rejects unrecognized session scopes instead of treating them as active', () => {
    const access = jwt.sign(
      { sub: 'user-1', typ: 'access', tv: 0, scope: 'admin' },
      process.env.JWT_ACCESS_SECRET!,
      {
        algorithm: 'HS256',
        issuer: 'chathouse-api',
        audience: 'chathouse-app',
        expiresIn: '5m',
      },
    );
    const refresh = jwt.sign(
      { sub: 'user-1', typ: 'refresh', jti: 'jti', scope: 'admin' },
      process.env.JWT_REFRESH_SECRET!,
      {
        algorithm: 'HS256',
        issuer: 'chathouse-api',
        audience: 'chathouse-app',
        expiresIn: '5m',
      },
    );

    expect(() => verifyAccessToken(access)).toThrow();
    expect(() => verifyRefreshToken(refresh)).toThrow();
  });

  it('rejects tokens signed with the wrong secret', () => {
    const forged = jwt.sign(
      { sub: 'u', typ: 'access', tv: 0 },
      'wrong-secret-wrong-secret-wrong!!',
      {
        algorithm: 'HS256',
        issuer: 'chathouse-api',
        audience: 'chathouse-app',
        expiresIn: '5m',
      },
    );
    expect(() => verifyAccessToken(forged)).toThrow();
  });

  it('rejects a non-HS256 token even when claims and secret are otherwise valid', () => {
    const token = jwt.sign({ sub: 'u', typ: 'access', tv: 0 }, process.env.JWT_ACCESS_SECRET!, {
      algorithm: 'HS384',
      issuer: 'chathouse-api',
      audience: 'chathouse-app',
      expiresIn: '5m',
    });
    expect(() => verifyAccessToken(token)).toThrow();
  });

  it('rejects a token with the right secret but the wrong audience', () => {
    const wrongAudience = jwt.sign(
      { sub: 'u', typ: 'access', tv: 0 },
      process.env.JWT_ACCESS_SECRET!,
      {
        algorithm: 'HS256',
        issuer: 'chathouse-api',
        audience: 'another-client',
        expiresIn: '5m',
      },
    );
    expect(() => verifyAccessToken(wrongAudience)).toThrow();
  });

  it('rejects a legacy impersonation claim without actor tokenVersion', () => {
    const incomplete = jwt.sign(
      { sub: 'u', typ: 'access', act: { sub: 'admin' } },
      process.env.JWT_ACCESS_SECRET!,
      {
        algorithm: 'HS256',
        issuer: 'chathouse-api',
        audience: 'chathouse-app',
        expiresIn: '5m',
      },
    );
    expect(() => verifyAccessToken(incomplete)).toThrow();
  });

  it('decodeTokenTtl returns positive seconds for a fresh token', () => {
    const token = signAccessToken('user-1');
    const ttl = decodeTokenTtl(token);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(15 * 60);
  });

  it('decodeTokenTtl returns 0 for garbage input', () => {
    expect(decodeTokenTtl('not-a-token')).toBe(0);
  });
});
