/**
 * Unit tests for pushService's permission-status surface (added so the
 * onboarding NotificationsPermission step can explain a refusal instead of
 * failing silently). Runs on the default jest platform (ios), where the
 * firebase-messaging mock drives the authorization outcomes:
 * AUTHORIZED/PROVISIONAL → 'granted', DENIED → 'blocked' (iOS never
 * re-prompts), NOT_DETERMINED → 'denied', native failure → 'error'.
 */
import messaging from '@react-native-firebase/messaging';
import { apiClient } from '../../../shared/services/api/apiClient';
import { pushService, requestNotificationPermissionStatus } from './pushService';

const messagingInstance = messaging();
const requestPermissionMock = messagingInstance.requestPermission as jest.Mock;
const getTokenMock = messagingInstance.getToken as jest.Mock;

describe('pushService permission status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pushService.resetTokenCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("maps AUTHORIZED to 'granted'", async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.AUTHORIZED);
    await expect(requestNotificationPermissionStatus()).resolves.toBe('granted');
  });

  it("maps PROVISIONAL to 'granted'", async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.PROVISIONAL);
    await expect(requestNotificationPermissionStatus()).resolves.toBe('granted');
  });

  it("maps an iOS DENIED to 'blocked' (the OS never re-prompts)", async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.DENIED);
    await expect(requestNotificationPermissionStatus()).resolves.toBe('blocked');
  });

  it("maps NOT_DETERMINED to 'denied'", async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.NOT_DETERMINED);
    await expect(requestNotificationPermissionStatus()).resolves.toBe('denied');
  });

  it('getOrRequestToken returns the token with a granted status', async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.AUTHORIZED);
    await expect(pushService.getOrRequestToken()).resolves.toEqual({
      token: 'test-fcm-token',
      status: 'granted',
    });
  });

  it('getOrRequestToken surfaces the refusal status without fetching a token', async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.DENIED);
    await expect(pushService.getOrRequestToken()).resolves.toEqual({
      token: null,
      status: 'blocked',
    });
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("getOrRequestToken reports 'error' when the native token fetch throws", async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.AUTHORIZED);
    getTokenMock.mockRejectedValueOnce(new Error('no play services'));
    await expect(pushService.getOrRequestToken()).resolves.toEqual({
      token: null,
      status: 'error',
    });
  });

  it('getOrRequestToken serves the cached token without re-prompting', async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.AUTHORIZED);
    await pushService.getOrRequestToken();
    requestPermissionMock.mockClear();
    await expect(pushService.getOrRequestToken()).resolves.toEqual({
      token: 'test-fcm-token',
      status: 'granted',
    });
    expect(requestPermissionMock).not.toHaveBeenCalled();
  });

  it('registerWithBackend posts the token and returns the granted status', async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.AUTHORIZED);
    const postSpy = jest.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });
    await expect(pushService.registerWithBackend()).resolves.toBe('granted');
    expect(postSpy).toHaveBeenCalledWith(
      '/push/register',
      expect.objectContaining({ token: 'test-fcm-token' }),
    );
  });

  it('registerWithBackend skips the POST and reports the refusal status', async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.DENIED);
    const postSpy = jest.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });
    await expect(pushService.registerWithBackend()).resolves.toBe('blocked');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('registerWithBackend stays best-effort when the backend POST rejects', async () => {
    requestPermissionMock.mockResolvedValueOnce(messaging.AuthorizationStatus.AUTHORIZED);
    jest.spyOn(apiClient, 'post').mockRejectedValue(new Error('network down'));
    await expect(pushService.registerWithBackend()).resolves.toBe('granted');
  });
});
