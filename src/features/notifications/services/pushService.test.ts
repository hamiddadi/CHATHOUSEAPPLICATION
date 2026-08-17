/**
 * Unit tests for pushService's permission-status surface (added so the
 * onboarding NotificationsPermission step can explain a refusal instead of
 * failing silently). Runs on the default jest platform (ios), where the
 * firebase-messaging mock drives the authorization outcomes:
 * AUTHORIZED/PROVISIONAL → 'granted', DENIED → 'blocked' (iOS never
 * re-prompts), NOT_DETERMINED → 'denied', native failure → 'error'.
 */
import {
  AuthorizationStatus,
  deleteToken,
  getToken,
  requestPermission,
} from '@react-native-firebase/messaging';
import { apiClient } from '../../../shared/services/api/apiClient';
import { pushService, requestNotificationPermissionStatus } from './pushService';

const requestPermissionMock = requestPermission as jest.Mock;
const getTokenMock = getToken as jest.Mock;
const deleteTokenMock = deleteToken as jest.Mock;

describe('pushService permission status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pushService.resetTokenCache();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("maps AUTHORIZED to 'granted'", async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.AUTHORIZED);
    await expect(requestNotificationPermissionStatus()).resolves.toBe('granted');
  });

  it("maps PROVISIONAL to 'granted'", async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.PROVISIONAL);
    await expect(requestNotificationPermissionStatus()).resolves.toBe('granted');
  });

  it("maps an iOS DENIED to 'blocked' (the OS never re-prompts)", async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.DENIED);
    await expect(requestNotificationPermissionStatus()).resolves.toBe('blocked');
  });

  it("maps NOT_DETERMINED to 'denied'", async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.NOT_DETERMINED);
    await expect(requestNotificationPermissionStatus()).resolves.toBe('denied');
  });

  it('getOrRequestToken returns the token with a granted status', async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.AUTHORIZED);
    await expect(pushService.getOrRequestToken()).resolves.toEqual({
      token: 'test-fcm-token',
      status: 'granted',
    });
  });

  it('getOrRequestToken surfaces the refusal status without fetching a token', async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.DENIED);
    await expect(pushService.getOrRequestToken()).resolves.toEqual({
      token: null,
      status: 'blocked',
    });
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it("getOrRequestToken reports 'error' when the native token fetch throws", async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.AUTHORIZED);
    getTokenMock.mockRejectedValueOnce(new Error('no play services'));
    await expect(pushService.getOrRequestToken()).resolves.toEqual({
      token: null,
      status: 'error',
    });
  });

  it('getOrRequestToken serves the cached token without re-prompting', async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.AUTHORIZED);
    await pushService.getOrRequestToken();
    requestPermissionMock.mockClear();
    await expect(pushService.getOrRequestToken()).resolves.toEqual({
      token: 'test-fcm-token',
      status: 'granted',
    });
    expect(requestPermissionMock).not.toHaveBeenCalled();
  });

  it('registerWithBackend posts the token and returns the granted status', async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.AUTHORIZED);
    const postSpy = jest.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });
    await expect(pushService.registerWithBackend()).resolves.toBe('granted');
    expect(postSpy).toHaveBeenCalledWith(
      '/push/register',
      expect.objectContaining({ token: 'test-fcm-token' }),
    );
  });

  it('registerWithBackend skips the POST and reports the refusal status', async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.DENIED);
    const postSpy = jest.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });
    await expect(pushService.registerWithBackend()).resolves.toBe('blocked');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it("registerWithBackend reports 'error' when the backend POST rejects", async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.AUTHORIZED);
    jest.spyOn(apiClient, 'post').mockRejectedValue(new Error('network down'));
    await expect(pushService.registerWithBackend()).resolves.toBe('error');
  });

  it("registerWithBackend reports 'error' when conflict recovery cannot register a replacement", async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.AUTHORIZED);
    getTokenMock.mockResolvedValueOnce('old-fcm-token').mockResolvedValueOnce('old-fcm-token');
    jest.spyOn(apiClient, 'post').mockRejectedValueOnce({
      kind: 'conflict',
      status: 409,
      code: 'PUSH_001',
      message: 'already bound',
    });

    await expect(pushService.registerWithBackend()).resolves.toBe('error');
    expect(deleteTokenMock).toHaveBeenCalledTimes(1);
  });

  it('rotates a token that is still bound to another account, then registers the replacement', async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.AUTHORIZED);
    getTokenMock
      .mockResolvedValueOnce('old-fcm-token')
      .mockResolvedValueOnce('replacement-fcm-token');
    const postSpy = jest
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce({
        kind: 'conflict',
        status: 409,
        code: 'PUSH_001',
        message: 'already bound',
      })
      .mockResolvedValueOnce({ data: {} });

    await expect(pushService.registerWithBackend()).resolves.toBe('granted');

    expect(deleteTokenMock).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenNthCalledWith(1, '/push/register', {
      token: 'old-fcm-token',
      platform: 'ios',
    });
    expect(postSpy).toHaveBeenNthCalledWith(2, '/push/register', {
      token: 'replacement-fcm-token',
      platform: 'ios',
    });
  });

  it('invalidates the local FCM token on sign-out even if backend unregister fails', async () => {
    requestPermissionMock.mockResolvedValueOnce(AuthorizationStatus.AUTHORIZED);
    await pushService.getOrRequestToken();
    const postSpy = jest
      .spyOn(apiClient, 'post')
      .mockRejectedValueOnce(new Error('expired session'));

    await expect(pushService.unregisterCurrentDevice()).resolves.toBeUndefined();

    expect(postSpy).toHaveBeenCalledWith('/push/unregister', { token: 'test-fcm-token' });
    expect(deleteTokenMock).toHaveBeenCalledTimes(1);
  });
});
