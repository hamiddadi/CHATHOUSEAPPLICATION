import React from 'react';
import { Alert } from 'react-native';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useCreateRoom } from '../../hooks/useRooms';
import { searchService } from '../../../search/services/searchService';
import { CreateRoomScreen } from './CreateRoomScreen';

// Keep roomKeys (and every other export) real; override only the mutation hook.
jest.mock('../../hooks/useRooms', () => {
  const actual = jest.requireActual('../../hooks/useRooms');
  return { ...actual, useCreateRoom: jest.fn() };
});

// Search runs in a debounced effect on keystrokes — stub it so no network/axios
// work happens and tests can drive the result list deterministically.
jest.mock('../../../search/services/searchService', () => ({
  searchService: { users: jest.fn().mockResolvedValue([]) },
}));

// The custom date picker is a JS-only child; replace it with a marker so the
// schedule tests stay focused on this screen's own branching.
jest.mock('../../components/DateTimePickerInline', () => {
  const { Text } = jest.requireActual('react-native');
  const DateTimePickerInlineMock: React.FC = () => <Text>date-time-picker</Text>;
  return { DateTimePickerInline: DateTimePickerInlineMock };
});

const mockUseCreateRoom = useCreateRoom as unknown as jest.Mock;
const mockUsersSearch = searchService.users as jest.Mock;

interface MutationStub {
  mutate: jest.Mock;
  mutateAsync: jest.Mock;
  isPending: boolean;
  isError: boolean;
  reset: jest.Mock;
}

const mutationStub = (over: Partial<MutationStub> = {}): MutationStub => ({
  mutate: jest.fn(),
  mutateAsync: jest.fn().mockResolvedValue({ id: 'room-1' }),
  isPending: false,
  isError: false,
  reset: jest.fn(),
  ...over,
});

const VALID_TITLE = 'Building in public';

describe('CreateRoomScreen', () => {
  beforeEach(() => {
    mockUseCreateRoom.mockReset();
    mockUsersSearch.mockReset();
    mockUsersSearch.mockResolvedValue([]);
    mockUseCreateRoom.mockReturnValue(mutationStub());
  });

  it('renders the header and primary action', () => {
    renderScreen(<CreateRoomScreen />);
    expect(screen.getByText(i18n.t('createRoom.title'))).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('createRoom.startRoom') })).toBeTruthy();
  });

  it('disables the start button until a long-enough title is entered', () => {
    renderScreen(<CreateRoomScreen />);
    const startButton = screen.getByRole('button', { name: i18n.t('createRoom.startRoom') });
    // Empty title => below TITLE_MIN => disabled.
    expect(startButton.props.accessibilityState?.disabled).toBe(true);

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('createRoom.topicPlaceholder')),
      VALID_TITLE,
    );
    expect(startButton.props.accessibilityState?.disabled).toBe(false);
  });

  it('creates the room and enters it on a successful (instant) submit', async () => {
    const mutateAsync = jest.fn().mockResolvedValue({ id: 'room-1' });
    mockUseCreateRoom.mockReturnValue(mutationStub({ mutateAsync }));
    const { navigation } = renderScreen(<CreateRoomScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('createRoom.topicPlaceholder')),
      VALID_TITLE,
    );
    fireEvent.press(screen.getByRole('button', { name: i18n.t('createRoom.startRoom') }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        title: VALID_TITLE,
        visibility: 'public',
        recordingEnabled: false,
      }),
    );
    // An instant room is live now → we replace the create modal with the room.
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('Room', { roomId: 'room-1' }),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('alerts and stays on screen when creation fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const mutateAsync = jest.fn().mockRejectedValue(new Error('boom'));
    mockUseCreateRoom.mockReturnValue(mutationStub({ mutateAsync }));
    const { navigation } = renderScreen(<CreateRoomScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('createRoom.topicPlaceholder')),
      VALID_TITLE,
    );
    fireEvent.press(screen.getByRole('button', { name: i18n.t('createRoom.startRoom') }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(
      i18n.t('createRoom.errorTitle', 'Création impossible'),
      'boom',
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('reveals the schedule presets when the schedule toggle is enabled', () => {
    renderScreen(<CreateRoomScreen />);
    // The +1 h preset only mounts once "Schedule for later" is switched on.
    expect(screen.queryByLabelText('Schedule +1 h')).toBeNull();
    fireEvent.press(screen.getByLabelText(i18n.t('createRoom.scheduleLabel')));
    expect(screen.getByLabelText('Schedule +1 h')).toBeTruthy();
  });

  it('searches users and adds a selected co-host', async () => {
    mockUsersSearch.mockResolvedValue([
      { id: 'u1', username: 'ada', displayName: 'Ada Lovelace', avatarUrl: null },
    ]);
    renderScreen(<CreateRoomScreen />);

    fireEvent.changeText(
      screen.getByPlaceholderText(i18n.t('createRoom.coHostsSearchPlaceholder')),
      'ada',
    );

    // Debounced effect (250ms) -> searchService.users -> result row.
    const hit = await screen.findByText('Ada Lovelace');
    await waitFor(() => expect(mockUsersSearch).toHaveBeenCalledWith('ada', 8));

    fireEvent.press(hit);
    // Once added the co-host renders as a removable @username chip.
    expect(await screen.findByText('@ada')).toBeTruthy();
  });
});
