import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useAdminStats, useAdminWhoami } from '../hooks/useAdmin';
import { adminService } from '../services/adminService';
import type { AdminStats, AppRole } from '../types/admin.types';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';
import { AdminHomeScreen } from './AdminHomeScreen';

jest.mock('../hooks/useAdmin', () => {
  const actual = jest.requireActual('../hooks/useAdmin');
  return { ...actual, useAdminStats: jest.fn(), useAdminWhoami: jest.fn() };
});

jest.mock('../services/adminService', () => ({
  adminService: { exportCsv: jest.fn().mockResolvedValue('id,name\n1,a') },
}));

const mockUseAdminStats = useAdminStats as unknown as jest.Mock;
const mockUseAdminWhoami = useAdminWhoami as unknown as jest.Mock;
const mockExportCsv = adminService.exportCsv as jest.Mock;

type Nav = SettingsStackScreenProps<'AdminHome'>['navigation'];

const makeNav = (): jest.Mocked<Pick<Nav, 'navigate'>> & Record<string, jest.Mock> => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: jest.fn(() => true),
});

const renderAdminHome = (nav = makeNav()) => {
  const utils = renderScreen(
    <AdminHomeScreen
      navigation={nav as unknown as Nav}
      route={{ key: 'AdminHome', name: 'AdminHome', params: undefined } as never}
    />,
  );
  return { ...utils, nav };
};

const statsFixture: AdminStats = {
  users: { total: 1200, online: 42, suspended: 3, new24h: 7, new7d: 31 },
  rooms: { live: 5, total: 88 },
  reports: { open: 2, total: 19 },
  messages: { last24h: 4567 },
};

const queryState = (over: Partial<ReturnType<typeof baseState>> = {}) => ({
  ...baseState(),
  ...over,
});

const baseState = () => ({
  data: undefined as AdminStats | undefined,
  isLoading: false,
  isError: false,
  isFetching: false,
  isRefetching: false,
  refetch: jest.fn(),
  error: null,
});

const whoami = (appRole: AppRole) => ({ data: { id: 'admin-1', appRole } });

describe('AdminHomeScreen', () => {
  beforeEach(() => {
    mockUseAdminStats.mockReset();
    mockUseAdminWhoami.mockReset();
    mockExportCsv.mockReset();
    mockExportCsv.mockResolvedValue('id,name\n1,a');
    mockUseAdminWhoami.mockReturnValue(whoami('SUPER_ADMIN'));
  });

  it('shows the loader while stats are loading', () => {
    mockUseAdminStats.mockReturnValue(queryState({ isLoading: true }));
    renderAdminHome();
    expect(screen.getByLabelText(i18n.t('admin.home.loading', 'Loading admin stats'))).toBeTruthy();
  });

  it('shows the error state when stats fail to load', () => {
    mockUseAdminStats.mockReturnValue(queryState({ isError: true }));
    renderAdminHome();
    expect(screen.getByText(i18n.t('admin.home.errorStats', 'Unable to load stats.'))).toBeTruthy();
  });

  it('renders the dashboard with KPI values when stats are loaded', () => {
    mockUseAdminStats.mockReturnValue(queryState({ data: statsFixture }));
    renderAdminHome();
    expect(screen.getByText(i18n.t('admin.home.title'))).toBeTruthy();
    expect(screen.getByText(String(statsFixture.users.total))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('admin.home.users'))).toBeTruthy();
  });

  it('navigates to the users management screen when its tile is pressed', () => {
    mockUseAdminStats.mockReturnValue(queryState({ data: statsFixture }));
    const { nav } = renderAdminHome();
    fireEvent.press(screen.getByLabelText(i18n.t('admin.home.users')));
    expect(nav.navigate).toHaveBeenCalledWith('AdminUsers');
  });

  it('hides the audit-log tile and CSV exports for a non-super-admin', () => {
    mockUseAdminWhoami.mockReturnValue(whoami('ADMIN'));
    mockUseAdminStats.mockReturnValue(queryState({ data: statsFixture }));
    renderAdminHome();
    expect(screen.queryByLabelText(i18n.t('admin.home.auditLog'))).toBeNull();
    expect(
      screen.queryByLabelText(i18n.t('admin.home.csvA11yUsers', 'Export users as CSV')),
    ).toBeNull();
    // The rooms tile (ADMIN-level) stays visible.
    expect(screen.getByLabelText(i18n.t('admin.home.rooms'))).toBeTruthy();
  });

  it('requests a CSV export when a super-admin presses an export button', async () => {
    mockUseAdminStats.mockReturnValue(queryState({ data: statsFixture }));
    renderAdminHome();
    fireEvent.press(
      screen.getByLabelText(i18n.t('admin.home.csvA11yUsers', 'Export users as CSV')),
    );
    await waitFor(() => expect(mockExportCsv).toHaveBeenCalledWith('users'));
  });
});
