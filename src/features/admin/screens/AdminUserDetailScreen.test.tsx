import React from 'react';
import { Alert } from 'react-native';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import {
  useAdminUser,
  useAdminWhoami,
  useDeleteUser,
  useSetUserRole,
  useSuspendUser,
  useUnsuspendUser,
} from '../hooks/useAdmin';
import { useImpersonationStore } from '../store/impersonationStore';
import type { AdminUserDetail, AppRole } from '../types/admin.types';
import type { SettingsStackScreenProps } from '../../../core/navigation/types';
import { AdminUserDetailScreen } from './AdminUserDetailScreen';

jest.mock('../hooks/useAdmin', () => {
  const actual = jest.requireActual('../hooks/useAdmin');
  return {
    ...actual,
    useAdminUser: jest.fn(),
    useAdminWhoami: jest.fn(),
    useDeleteUser: jest.fn(),
    useSetUserRole: jest.fn(),
    useSuspendUser: jest.fn(),
    useUnsuspendUser: jest.fn(),
  };
});

jest.mock('../store/impersonationStore', () => ({
  useImpersonationStore: jest.fn(),
}));

const mockUseAdminUser = useAdminUser as jest.Mock;
const mockUseAdminWhoami = useAdminWhoami as jest.Mock;
const mockUseDeleteUser = useDeleteUser as jest.Mock;
const mockUseSetUserRole = useSetUserRole as jest.Mock;
const mockUseSuspendUser = useSuspendUser as jest.Mock;
const mockUseUnsuspendUser = useUnsuspendUser as jest.Mock;
const mockUseImpersonationStore = useImpersonationStore as unknown as jest.Mock;

const queryState = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  data: undefined,
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  isRefetching: false,
  isFetching: false,
  error: null,
  ...over,
});

const mutationState = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue(undefined),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  ...over,
});

const makeUser = (over: Partial<AdminUserDetail> = {}): AdminUserDetail =>
  ({
    id: 'u1',
    username: 'janedoe',
    displayName: 'Jane Doe',
    email: 'jane@example.com',
    phoneNumber: null,
    avatarUrl: null,
    appRole: 'USER',
    isOnline: true,
    suspendedUntil: null,
    suspensionReason: null,
    followerCount: 12,
    followingCount: 7,
    deletedAt: null,
    createdAt: '2024-01-15T10:00:00.000Z',
    lastSeenAt: '2024-02-01T08:30:00.000Z',
    bio: null,
    twitter: null,
    instagram: null,
    interests: [],
    currentRoomId: null,
    ...over,
  }) as AdminUserDetail;

const startImpersonation = jest.fn().mockResolvedValue(undefined);

// This screen receives `route`/`navigation` as React Navigation screen props
// (not via hooks), so we build them here and pass them in directly.
const makeNavProps = (
  userId = 'u1',
): Pick<SettingsStackScreenProps<'AdminUserDetail'>, 'route' | 'navigation'> => {
  const navigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    popToTop: jest.fn(),
    push: jest.fn(),
    canGoBack: jest.fn(() => true),
  } as unknown as SettingsStackScreenProps<'AdminUserDetail'>['navigation'];
  const route = {
    key: 'AdminUserDetail-route',
    name: 'AdminUserDetail',
    params: { userId },
  } as unknown as SettingsStackScreenProps<'AdminUserDetail'>['route'];
  return { navigation, route };
};

const setRole = (role: AppRole): void => {
  mockUseAdminWhoami.mockReturnValue(queryState({ data: { appRole: role } }));
};

describe('AdminUserDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAdminWhoami.mockReturnValue(queryState({ data: { appRole: 'ADMIN' } }));
    mockUseAdminUser.mockReturnValue(queryState({ data: makeUser() }));
    mockUseSetUserRole.mockReturnValue(mutationState());
    mockUseSuspendUser.mockReturnValue(mutationState());
    mockUseUnsuspendUser.mockReturnValue(mutationState());
    mockUseDeleteUser.mockReturnValue(mutationState());
    mockUseImpersonationStore.mockImplementation((selector?: (s: unknown) => unknown) => {
      const state = { start: startImpersonation };
      return selector ? selector(state) : state;
    });
  });

  it('shows the loader while the user is loading', () => {
    mockUseAdminUser.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<AdminUserDetailScreen {...makeNavProps()} />);
    expect(screen.getByLabelText(i18n.t('common.loading', 'Loading…'))).toBeTruthy();
  });

  it('shows the not-found empty state on error', () => {
    mockUseAdminUser.mockReturnValue(queryState({ isError: true, data: undefined }));
    renderScreen(<AdminUserDetailScreen {...makeNavProps()} />);
    expect(screen.getByText(i18n.t('admin.userDetail.notFound'))).toBeTruthy();
  });

  it('renders the loaded user details', () => {
    mockUseAdminUser.mockReturnValue(queryState({ data: makeUser() }));
    renderScreen(<AdminUserDetailScreen {...makeNavProps()} />);
    // "Jane Doe" appears in both the header and the hero block.
    expect(screen.getAllByText('Jane Doe').length).toBeGreaterThan(0);
    expect(screen.getByText(i18n.t('admin.userDetail.infoTitle'))).toBeTruthy();
    expect(screen.getByText('jane@example.com')).toBeTruthy();
  });

  it('hides moderation actions when the actor cannot act on the target', () => {
    // Actor is ADMIN, target is SUPER_ADMIN -> rank not strictly higher.
    setRole('ADMIN');
    mockUseAdminUser.mockReturnValue(queryState({ data: makeUser({ appRole: 'SUPER_ADMIN' }) }));
    renderScreen(<AdminUserDetailScreen {...makeNavProps()} />);
    expect(screen.getByText(i18n.t('admin.userDetail.noActionPerm'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('admin.userDetail.suspendSection'))).toBeNull();
  });

  it('suspends the user when a suspension preset is pressed', async () => {
    const suspend = mutationState();
    mockUseSuspendUser.mockReturnValue(suspend);
    mockUseAdminUser.mockReturnValue(queryState({ data: makeUser({ appRole: 'USER' }) }));
    // Under jest-expo (iOS), Alert.prompt exists, so promptForReason shows the
    // text prompt and only submits on the destructive button. Drive that button
    // so onSubmit fires with the empty -> defaultReason ('Moderation').
    const promptSpy = jest
      .spyOn(Alert as unknown as { prompt: (...a: unknown[]) => void }, 'prompt')
      .mockImplementation((...a: unknown[]) => {
        const buttons = a[2] as { style?: string; onPress?: (t?: string) => void }[];
        buttons.find(b => b.style === 'destructive')?.onPress?.(undefined);
      });

    renderScreen(<AdminUserDetailScreen {...makeNavProps()} />);

    fireEvent.press(screen.getByLabelText(`Suspendre ${i18n.t('admin.userDetail.suspend1h')}`));

    await waitFor(() => {
      expect(suspend.mutate as jest.Mock).toHaveBeenCalledTimes(1);
    });
    promptSpy.mockRestore();
    const [args] = (suspend.mutate as jest.Mock).mock.calls[0];
    expect(args).toEqual(
      expect.objectContaining({ userId: 'u1', reason: 'Moderation', durationMinutes: 60 }),
    );
  });

  it('exposes the role section to a super admin acting on a regular user', () => {
    setRole('SUPER_ADMIN');
    mockUseAdminUser.mockReturnValue(queryState({ data: makeUser({ appRole: 'USER' }) }));
    renderScreen(<AdminUserDetailScreen {...makeNavProps()} />);
    expect(screen.getByText(i18n.t('admin.userDetail.roleSection'))).toBeTruthy();
    expect(screen.getByLabelText('Définir le rôle ADMIN')).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.userDetail.dangerSection'))).toBeTruthy();
  });
});
