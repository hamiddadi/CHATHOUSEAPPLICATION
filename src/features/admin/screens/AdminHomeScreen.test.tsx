/**
 * AdminHomeScreen render + button tests. This screen reads `navigation` from its
 * PROPS (not the useNavigation hook), so we build a shared navigation spy and
 * pass it both as a prop AND to renderScreen (the latter wires AdminHeader's
 * internal useNavigation). Data-driven: with no cached stats it shows a loader,
 * so we seed `adminKeys.stats()`. The admin role gating (`canForceEnd`,
 * `canSeeAuditLog`) reads `adminKeys.whoami()`, which we seed as SUPER_ADMIN so
 * every NavTile + the CSV export buttons render.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { adminKeys } from '../hooks/useAdmin';
import type { AdminStats, AppRole } from '../types/admin.types';
import { makeNavigationSpy } from '../../../test-utils/navigationMock';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';
import { AdminHomeScreen } from './AdminHomeScreen';

const fakeStats = (overrides: Partial<AdminStats> = {}): AdminStats => ({
  users: { total: 1200, online: 42, suspended: 3, new24h: 10, new7d: 70 },
  rooms: { live: 5, total: 300 },
  reports: { open: 2, total: 25 },
  messages: { last24h: 5000 },
  ...overrides,
});

const seedWith = (role: AppRole, stats: AdminStats = fakeStats()) => [
  { key: [...adminKeys.whoami()], data: { id: 'admin-1', appRole: role } },
  { key: [...adminKeys.stats()], data: stats },
];

// Build the props the screen reads (it pulls `navigation` off props directly).
const propsFor = (
  navigation: ReturnType<typeof makeNavigationSpy>,
): SettingsStackScreenProps<'AdminHome'> =>
  ({ navigation, route: { key: 'k', name: 'AdminHome', params: undefined } }) as never;

describe('AdminHomeScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('shows the loader (crash-free) before stats are cached', () => {
    const navigation = makeNavigationSpy();
    const { getByLabelText, toJSON } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
    });
    expect(toJSON()).toBeTruthy();
    expect(getByLabelText('Loading admin stats')).toBeTruthy();
  });

  it('mounts with seeded stats and renders the KPI title', () => {
    const navigation = makeNavigationSpy();
    const { getByText, toJSON } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedWith('SUPER_ADMIN'),
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Administration')).toBeTruthy();
  });

  it('User Management tile navigates to AdminUsers', () => {
    const navigation = makeNavigationSpy();
    const { getByLabelText } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedWith('SUPER_ADMIN'),
    });
    fireEvent.press(getByLabelText('User Management'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdminUsers');
  });

  it('Reports tile navigates to AdminReports', () => {
    const navigation = makeNavigationSpy();
    const { getByLabelText } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedWith('SUPER_ADMIN'),
    });
    fireEvent.press(getByLabelText('Reports'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdminReports');
  });

  it('Active Rooms tile (ADMIN+) navigates to AdminRooms', () => {
    const navigation = makeNavigationSpy();
    const { getByLabelText } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedWith('SUPER_ADMIN'),
    });
    fireEvent.press(getByLabelText('Active Rooms'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdminRooms');
  });

  it('Audit Log tile (SUPER_ADMIN) navigates to AdminAuditLog', () => {
    const navigation = makeNavigationSpy();
    const { getByLabelText } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedWith('SUPER_ADMIN'),
    });
    fireEvent.press(getByLabelText('Audit Log'));
    expect(navigation.navigate).toHaveBeenCalledWith('AdminAuditLog');
  });

  it('hides the Audit Log tile + CSV exports for a plain ADMIN', () => {
    const navigation = makeNavigationSpy();
    const { queryByLabelText } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedWith('ADMIN'),
    });
    // Audit Log nav tile is SUPER_ADMIN-only.
    expect(queryByLabelText('Audit Log')).toBeNull();
    // CSV export buttons are gated behind the same SUPER_ADMIN check.
    expect(queryByLabelText('Export users as CSV')).toBeNull();
    // But the ADMIN-level "Active Rooms" tile is still present.
    expect(queryByLabelText('Active Rooms')).toBeTruthy();
  });

  it('CSV "Export users" button is pressable without crashing (SUPER_ADMIN)', () => {
    const navigation = makeNavigationSpy();
    const { getByLabelText, toJSON } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedWith('SUPER_ADMIN'),
    });
    // The handler is async (export → clipboard → share); the press itself must
    // not throw synchronously. We don't await the network call.
    fireEvent.press(getByLabelText('Export users as CSV'));
    expect(toJSON()).toBeTruthy();
  });
});
