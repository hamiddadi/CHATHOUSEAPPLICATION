import { env } from '../src/config/env';
import { authService } from '../src/modules/auth/auth.service';
import { otpService } from '../src/modules/otp/otp.service';

describe('16+ age policy', () => {
  const originalNodeEnv = env.NODE_ENV;

  beforeEach(() => {
    // Runtime services intentionally relax this gate only for legacy fixtures
    // in NODE_ENV=test. Exercise the actual production/development branch.
    env.NODE_ENV = 'development';
  });

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
  });

  it('rejects password registration without explicit age confirmation', async () => {
    await expect(
      authService.register({
        username: 'age_policy_test',
        email: 'age-policy@test.local',
        password: 'test-password-123',
        ageConfirmed: false,
      }),
    ).rejects.toMatchObject({ code: 'AGE_001' });
  });

  it('rejects the OTP entry point without explicit age confirmation', async () => {
    await expect(
      otpService.send({ phoneNumber: '+14155550199', ageConfirmed: false }),
    ).rejects.toMatchObject({ code: 'AGE_001' });
  });
});
