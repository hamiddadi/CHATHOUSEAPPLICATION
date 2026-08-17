import {
  beginSocketServerDrain,
  resetSocketServerDrainForTests,
  shouldPreserveParticipationForReconnect,
} from '../src/socket/server-drain';

describe('Socket.IO disconnect participation policy', () => {
  beforeEach(resetSocketServerDrainForTests);

  it.each(['client namespace disconnect', 'server namespace disconnect'])(
    'applies explicit %s immediately',
    reason => {
      expect(shouldPreserveParticipationForReconnect(reason)).toBe(false);
    },
  );

  it.each(['ping timeout', 'transport close', 'transport error', 'forced close', 'parse error'])(
    'preserves %s for bounded reconnect grace',
    reason => {
      expect(shouldPreserveParticipationForReconnect(reason)).toBe(true);
    },
  );

  it('preserves server shutdown only after the process entered drain mode', () => {
    expect(shouldPreserveParticipationForReconnect('server shutting down')).toBe(false);
    beginSocketServerDrain();
    expect(shouldPreserveParticipationForReconnect('server shutting down')).toBe(true);
  });
});
