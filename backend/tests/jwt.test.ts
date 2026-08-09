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
    const first = verifyAccessToken(signImpersonationToken('user-1', 'admin-1'));
    const second = verifyAccessToken(signImpersonationToken('user-1', 'admin-1'));

    expect(first.jti).toEqual(expect.any(String));
    expect(second.jti).not.toBe(first.jti);
  });

  it('still verifies a pre-rollout access token without jti', () => {
    const legacy = jwt.sign(
      { sub: 'legacy-user', typ: 'access', tv: 0 },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: '5m' },
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
    expect(claims.sub).toBe('user-1');
    expect(claims.jti).toBe('jti-abc');
    expect(claims.typ).toBe('refresh');
  });

  it('rejects tokens signed with the wrong secret', () => {
    const forged = jwt.sign({ sub: 'u', typ: 'access' }, 'wrong-secret-wrong-secret-wrong!!', {
      expiresIn: '5m',
    });
    expect(() => verifyAccessToken(forged)).toThrow();
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
