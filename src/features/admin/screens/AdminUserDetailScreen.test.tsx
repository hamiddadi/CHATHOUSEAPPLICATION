/**
 * AdminUserDetailScreen render + button tests. Reads `route.params.userId` and
 * `navigation` from PROPS. Data-driven: needs `adminKeys.user(userId)` (the
 * target) and `adminKeys.whoami()` (the acting admin — SUPER_ADMIN so role +
 * impersonate + delete sections all surface, and rank > target so actions are
 * permitted). Buttons either open an Alert (role / unsuspend / impersonate /
 * delete) or go through the reason prompt (suspend presets): native
 * Alert.prompt on iOS, a feature-local modal on Android. We drive the Android
 * modal path (which is where the previous silent no-op lived) end-to-end and
 * assert the suspend mutation fires with the typed reason.
 */
import React from 'react';
import { Alert, Platform } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { adminKeys } from '../hooks/useAdmin';
import { adminService } from '../services/adminService';
import type { AdminUser, AdminUserDetail, AppRole } from '../types/admin.types';
import { makeNavigationSpy } from '../../../test-utils/navigationMock';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';
import { AdminUserDetailScreen } from './AdminUserDetailScreen';

const USER_ID = 'target-1';

const fakeDetail = (overrides: Partial<AdminUserDetail> = {}): AdminUserDetail => ({
  id: USER_ID,
  username: 'targetuser',
  displayName: 'Target User',
  email: 'target@example.com',
  phoneNumber: '+10000000000',
  avatarUrl: null,
  appRole: 'USER',
  isOnline: false,
  suspendedUntil: null,
  suspensionReason: null,
  followerCount: 1,
  followingCount: 2,
  deletedAt: null,
  createdAt: new Date(0).toISOString(),
  lastSeenAt: null,
  bio: null,
  twitter: null,
  instagram: null,
  interests: [],
  currentRoomId: null,
  ...overrides,
});

const seedDetail = (detail: AdminUserDetail, viewerRole: AppRole = 'SUPER_ADMIN') => [
  { key: [...adminKeys.user(detail.id)], data: detail },
  { key: [...adminKeys.whoami()], data: { id: 'admin-1', appRole: viewerRole } },
];

const propsFor = (
  navigation: ReturnType<typeof makeNavigationSpy>,
  userId: string = USER_ID,
): SettingsStackScreenProps<'AdminUserDetail'> =>
  ({ navigation, route: { key: 'k', name: 'AdminUserDetail', params: { userId } } }) as never;

describe('AdminUserDetailScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('shows the loader (crash-free) before the user is cached', () => {
    const navigation = makeNavigationSpy();
    const { getByLabelText, toJSON } = renderScreen(
      <AdminUserDetailScreen {...propsFor(navigation)} />,
      { navigation },
    );
    expect(toJSON()).toBeTruthy();
    expect(getByLabelText('Loading…')).toBeTruthy();
  });

  it('mounts with the seeded user and shows the Information section', () => {
    const navigation = makeNavigationSpy();
    const { getByText, toJSON } = renderScreen(
      <AdminUserDetailScreen {...propsFor(navigation)} />,
      { navigation, seedQueryData: seedDetail(fakeDetail()) },
    );
    expect(toJSON()).toBeTruthy();
    expect(getByText('Information')).toBeTruthy();
    expect(getByText('target@example.com')).toBeTruthy();
  });

  describe('suspend flow (Android modal path)', () => {
    const ORIGINAL_OS = Platform.OS;
    beforeEach(() => {
      // Force the Android branch of useReasonPrompt so the feature-local modal
      // renders (Alert.prompt is a no-op on Android — this is the regression).
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    });
    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { value: ORIGINAL_OS, configurable: true });
    });

    it('tapping a suspend preset opens the reason modal; confirming calls suspend with the typed reason + duration', async () => {
      const suspendSpy = jest
        .spyOn(adminService, 'suspend')
        .mockResolvedValue({ id: USER_ID } as AdminUser);
      const navigation = makeNavigationSpy();
      const { getByLabelText, getByText, queryByLabelText } = renderScreen(
        <AdminUserDetailScreen {...propsFor(navigation)} />,
        { navigation, seedQueryData: seedDetail(fakeDetail()) },
      );

      // The modal is not mounted until a preset is tapped.
      expect(queryByLabelText('Reason for the suspension')).toBeNull();

      // "1 hour" preset → 60 minutes.
      fireEvent.press(getByLabelText('Suspend 1 hour'));

      // Modal opens with its multiline reason field.
      const field = getByLabelText('Reason for the suspension');
      expect(field).toBeTruthy();
      fireEvent.changeText(field, '  Repeated spam  ');

      // Confirm → mutation fires with the trimmed reason and the preset duration.
      fireEvent.press(getByText('Suspend'));
      await waitFor(() => expect(suspendSpy).toHaveBeenCalledTimes(1));
      expect(suspendSpy).toHaveBeenCalledWith(USER_ID, {
        reason: 'Repeated spam',
        durationMinutes: 60,
      });
    });

    it('cancelling the reason modal does NOT call suspend', async () => {
      const suspendSpy = jest
        .spyOn(adminService, 'suspend')
        .mockResolvedValue({ id: USER_ID } as AdminUser);
      const navigation = makeNavigationSpy();
      const { getByLabelText, getByText, queryByLabelText } = renderScreen(
        <AdminUserDetailScreen {...propsFor(navigation)} />,
        { navigation, seedQueryData: seedDetail(fakeDetail()) },
      );

      fireEvent.press(getByLabelText('Suspend Permanent'));
      expect(getByLabelText('Reason for the suspension')).toBeTruthy();

      fireEvent.press(getByText('Cancel'));

      // Modal closed, and no mutation happened.
      await waitFor(() => expect(queryByLabelText('Reason for the suspension')).toBeNull());
      expect(suspendSpy).not.toHaveBeenCalled();
    });

    it('confirming with an empty reason falls back to the default motif', async () => {
      const suspendSpy = jest
        .spyOn(adminService, 'suspend')
        .mockResolvedValue({ id: USER_ID } as AdminUser);
      const navigation = makeNavigationSpy();
      const { getByLabelText, getByText } = renderScreen(
        <AdminUserDetailScreen {...propsFor(navigation)} />,
        { navigation, seedQueryData: seedDetail(fakeDetail()) },
      );

      fireEvent.press(getByLabelText('Suspend 24 hours'));
      // Leave the field empty and confirm.
      fireEvent.press(getByText('Suspend'));
      await waitFor(() => expect(suspendSpy).toHaveBeenCalledTimes(1));
      expect(suspendSpy).toHaveBeenCalledWith(USER_ID, {
        reason: 'Moderation',
        durationMinutes: 60 * 24,
      });
    });
  });

  it('a suspend preset uses the native Alert.prompt on iOS (crash-free)', () => {
    // On iOS the reason is collected by Alert.prompt (no modal). Spy so the
    // press is inert but recorded — this asserts we do NOT open the modal there.
    const promptSpy = jest
      .spyOn(Alert, 'prompt' as never)
      .mockImplementation(() => undefined as never);
    const navigation = makeNavigationSpy();
    const { getByLabelText, queryByLabelText } = renderScreen(
      <AdminUserDetailScreen {...propsFor(navigation)} />,
      { navigation, seedQueryData: seedDetail(fakeDetail()) },
    );
    fireEvent.press(getByLabelText('Suspend 1 hour'));
    expect(promptSpy).toHaveBeenCalledTimes(1);
    // No Android modal on iOS.
    expect(queryByLabelText('Reason for the suspension')).toBeNull();
  });

  it('a role button opens the confirm Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const navigation = makeNavigationSpy();
    const { getByLabelText } = renderScreen(<AdminUserDetailScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedDetail(fakeDetail({ appRole: 'USER' })),
    });
    // Promote to MODERATOR (not the current role, so the button is enabled).
    fireEvent.press(getByLabelText('Set role MODERATOR'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('the Impersonate button opens the confirm Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const navigation = makeNavigationSpy();
    const { getByText } = renderScreen(<AdminUserDetailScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedDetail(fakeDetail()),
    });
    fireEvent.press(getByText('Impersonate'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('the Delete account button opens the confirm Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const navigation = makeNavigationSpy();
    const { getByText } = renderScreen(<AdminUserDetailScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedDetail(fakeDetail()),
    });
    fireEvent.press(getByText('Delete account'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('the Lift suspension button (suspended target) opens the confirm Alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const navigation = makeNavigationSpy();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const { getByText } = renderScreen(<AdminUserDetailScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedDetail(fakeDetail({ suspendedUntil: future })),
    });
    fireEvent.press(getByText('Lift suspension'));
    expect(alertSpy).toHaveBeenCalled();
  });

  it('shows the no-permission note when the viewer cannot act on the target', () => {
    const navigation = makeNavigationSpy();
    // Viewer is ADMIN, target is also ADMIN → rank not strictly higher.
    const { getByText, queryByText } = renderScreen(
      <AdminUserDetailScreen {...propsFor(navigation)} />,
      { navigation, seedQueryData: seedDetail(fakeDetail({ appRole: 'ADMIN' }), 'ADMIN') },
    );
    expect(getByText("You don't have permission to act on this user.")).toBeTruthy();
    // Action sections are hidden in this case.
    expect(queryByText('Delete account')).toBeNull();
  });

  it('hides the Suspension section for a soft-deleted account', () => {
    const navigation = makeNavigationSpy();
    const { queryByText } = renderScreen(<AdminUserDetailScreen {...propsFor(navigation)} />, {
      navigation,
      seedQueryData: seedDetail(fakeDetail({ deletedAt: new Date(0).toISOString() })),
    });
    // A deleted account can't be suspended — the section title is gone.
    expect(queryByText('Suspension')).toBeNull();
  });
});
