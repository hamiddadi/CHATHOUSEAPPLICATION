import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from '../../../shared/services/api/apiClient';
import { useGhostModeStore } from './ghostModeStore';

jest.mock('../../../shared/services/api/apiClient', () => ({
  apiClient: {
    patch: jest.fn(),
  },
}));

const patch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;

describe('ghostModeStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useGhostModeStore.setState({
      isGhost: false,
      isHydrated: true,
      isToggling: false,
    });
  });

  it('shows hidden only after the server confirms and persists that state', async () => {
    patch.mockResolvedValue({ data: { data: { id: 'user-1', isVisible: false } } });

    await useGhostModeStore.getState().setGhost(true);

    expect(patch).toHaveBeenCalledWith('/users/me/visibility', { isVisible: false });
    expect(useGhostModeStore.getState().isGhost).toBe(true);
    expect(setItem).toHaveBeenCalledWith('chathouse.ghostMode.v1', '1');
  });

  it('keeps the visible state when the server cannot clear visibility', async () => {
    patch.mockRejectedValue(new Error('offline'));

    await expect(useGhostModeStore.getState().setGhost(true)).rejects.toThrow('offline');

    expect(useGhostModeStore.getState().isGhost).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('keeps a server-confirmed privacy change if local persistence fails', async () => {
    patch.mockResolvedValue({ data: { data: { id: 'user-1', isVisible: false } } });
    setItem.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(useGhostModeStore.getState().setGhost(true)).resolves.toBeUndefined();

    expect(useGhostModeStore.getState().isGhost).toBe(true);
  });
});
