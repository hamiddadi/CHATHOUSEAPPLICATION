/**
 * Deep-link routing tests for the two invite-shaped links that share an
 * `/invite/<…>` segment but must behave differently:
 *
 *   1. Referral link `…/invite/<code>` → captured into the invite store for
 *      post-onboarding redemption; navigation falls through (no target).
 *   2. House-invite link `house/:houseId/invite/:token` → must NOT be captured
 *      as a referral; it has to reach HouseInvitationScreen with both the
 *      houseId and the (sanitized) token as params.
 *
 * The regression this guards: the referral capture used to swallow the house
 * link (both contain `/invite/`), leaving HouseInvitationScreen unreachable.
 */
import { useInviteStore } from '../../features/extensions/store/inviteStore';
import { linking } from './linking';

type GetState = NonNullable<typeof linking.getStateFromPath>;
const getState = linking.getStateFromPath as GetState;
const options = linking.config;

// Walk a react-navigation state tree to find the deepest active route.
const activeRoute = (state: unknown): { name: string; params?: Record<string, unknown> } | null => {
  let node = state as
    | {
        routes?: Array<{ name: string; params?: Record<string, unknown>; state?: unknown }>;
        index?: number;
      }
    | undefined;
  let leaf: { name: string; params?: Record<string, unknown> } | null = null;
  while (node?.routes) {
    const idx = node.index ?? node.routes.length - 1;
    const route = node.routes[idx];
    if (!route) break;
    leaf = { name: route.name, params: route.params };
    node = route.state as typeof node;
  }
  return leaf;
};

describe('linking — invite deep links', () => {
  beforeEach(() => {
    useInviteStore.getState().clear();
  });

  it('captures a referral link into the invite store and does not navigate', () => {
    const result = getState('invite/abc123.deadbeef', options);
    // Referral → falls through: no explicit navigation target.
    expect(result).toBeUndefined();
    expect(useInviteStore.getState().pendingCode).toBe('abc123.deadbeef');
  });

  it('still captures a referral link nested under a non-house segment', () => {
    const result = getState('some/path/invite/xyz789', options);
    expect(result).toBeUndefined();
    expect(useInviteStore.getState().pendingCode).toBe('xyz789');
  });

  it('routes a house-invite link to HouseInvitation with houseId + token (NOT captured as referral)', () => {
    const result = getState('house/h1/invite/tok_abcDEF123', options);
    // Must NOT have been swallowed by the referral capture.
    expect(result).toBeDefined();
    expect(useInviteStore.getState().pendingCode).toBeNull();

    const leaf = activeRoute(result);
    expect(leaf?.name).toBe('HouseInvitation');
    expect(leaf?.params?.houseId).toBe('h1');
    expect(leaf?.params?.inviteToken).toBe('tok_abcDEF123');
  });

  it('routes a house-invite link with no token to HouseInvitation (optional token)', () => {
    const result = getState('house/h2/invite/', options);
    expect(useInviteStore.getState().pendingCode).toBeNull();
    const leaf = activeRoute(result);
    expect(leaf?.name).toBe('HouseInvitation');
    expect(leaf?.params?.houseId).toBe('h2');
  });

  it('drops an oversized/malformed house-invite token but still routes the screen', () => {
    // A token with a disallowed character is sanitized away; the screen still
    // mounts (optional param) and surfaces its own "invalid invite" state.
    const badToken = 'bad token!with spaces';
    const result = getState(`house/h3/invite/${encodeURIComponent(badToken)}`, options);
    const leaf = activeRoute(result);
    expect(leaf?.name).toBe('HouseInvitation');
    expect(leaf?.params?.houseId).toBe('h3');
    expect(leaf?.params?.inviteToken).toBeUndefined();
  });
});
