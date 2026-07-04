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
import { Alert, Share } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { adminKeys } from '../hooks/useAdmin';
import { adminService } from '../services/adminService';
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

  it('CSV "Export users" shares the export and does NOT auto-copy PII to the clipboard', async () => {
    const FAKE_CSV = 'id,email,phone\n1,alice@example.com,+15550001\n';
    const exportSpy = jest.spyOn(adminService, 'exportCsv').mockResolvedValue(FAKE_CSV);
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);
    const clipboardSpy = jest.spyOn(Clipboard, 'setString').mockReturnValue(undefined as never);

    const navigation = makeNavigationSpy();
    const { getByLabelText } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedWith('SUPER_ADMIN'),
    });

    fireEvent.press(getByLabelText('Export users as CSV'));

    // Default hand-off is the Share sheet carrying the full CSV.
    await waitFor(() => expect(exportSpy).toHaveBeenCalledWith('users'));
    await waitFor(() =>
      expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({ message: FAKE_CSV })),
    );
    // PII must NOT be silently written to the system clipboard.
    expect(clipboardSpy).not.toHaveBeenCalled();
  });

  it('the opt-in "Copy last export" confirms before writing PII to the clipboard', async () => {
    const FAKE_CSV = 'id,email\n1,alice@example.com\n';
    jest.spyOn(adminService, 'exportCsv').mockResolvedValue(FAKE_CSV);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const clipboardSpy = jest.spyOn(Clipboard, 'setString').mockReturnValue(undefined as never);
    // Capture the confirmation Alert and fire its destructive "Copy" button.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      const confirm = buttons?.find(b => b.style === 'destructive');
      confirm?.onPress?.();
    });

    const navigation = makeNavigationSpy();
    const { getByLabelText } = renderScreen(<AdminHomeScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedWith('SUPER_ADMIN'),
    });

    // Export first so there is a payload to copy.
    fireEvent.press(getByLabelText('Export users as CSV'));
    await waitFor(() => expect(clipboardSpy).not.toHaveBeenCalled());

    // Opt-in copy → confirmation Alert → then (and only then) the clipboard write.
    fireEvent.press(getByLabelText('Copy the last export to clipboard'));
    expect(alertSpy).toHaveBeenCalled();
    await waitFor(() => expect(clipboardSpy).toHaveBeenCalledWith(FAKE_CSV));
  });
});
