import notifee, { EventType } from '@notifee/react-native';
import messaging from '@react-native-firebase/messaging';
import {
  getInitialNotificationDeepLink,
  handleBackgroundNotificationEvent,
  notificationDataToDeepLink,
  resetNotificationOpenStateForTests,
  subscribeToNotificationDeepLinks,
} from './notificationOpenService';

const messagingInstance = messaging();
const getInitialMessageMock = messagingInstance.getInitialNotification as jest.Mock;
const onNotificationOpenedAppMock = messagingInstance.onNotificationOpenedApp as jest.Mock;
const getInitialNotifeeMock = notifee.getInitialNotification as jest.Mock;
const onForegroundEventMock = notifee.onForegroundEvent as jest.Mock;

describe('notification open deep links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetNotificationOpenStateForTests();
    getInitialMessageMock.mockResolvedValue(null);
    getInitialNotifeeMock.mockResolvedValue(null);
    onNotificationOpenedAppMock.mockReturnValue(jest.fn());
    onForegroundEventMock.mockReturnValue(jest.fn());
  });

  it.each([
    ['a room event', { type: 'ROOM_STARTED', roomId: 'room/1' }, 'chathouse://room/room%2F1'],
    [
      'a direct message',
      { type: 'NEW_MESSAGE', conversation: 'dm', senderId: 'user-1' },
      'chathouse://chat/user-1',
    ],
    [
      'a group message',
      { type: 'NEW_MESSAGE', conversation: 'group', conversationId: 'group-1' },
      'chathouse://group/group-1',
    ],
    ['a follower', { type: 'NEW_FOLLOWER', followerId: 'user-2' }, 'chathouse://u/user-2'],
    [
      'an inbound house invitation',
      { type: 'CLUB_INVITE', clubId: 'house-1', inviterId: 'user-3' },
      'chathouse://house/house-1/invite',
    ],
    [
      'an approved house request',
      { type: 'CLUB_INVITE', kind: 'join_approved', clubId: 'house-1' },
      'chathouse://house/house-1',
    ],
  ])('maps %s to its canonical route', (_label, data, expected) => {
    expect(notificationDataToDeepLink(data)).toBe(expected);
  });

  it('falls back to the notification list for incomplete or unsafe payloads', () => {
    expect(notificationDataToDeepLink(undefined)).toBe('chathouse://notifications');
    expect(
      notificationDataToDeepLink({
        type: 'NEW_MESSAGE',
        senderId: 'x'.repeat(257),
      }),
    ).toBe('chathouse://notifications');
    expect(
      notificationDataToDeepLink({
        type: 'CLUB_INVITE',
        kind: 'join_declined',
        clubId: 'private-house',
      }),
    ).toBe('chathouse://notifications');
  });

  it('uses an FCM cold-start notification before the Notifee fallback', async () => {
    getInitialMessageMock.mockResolvedValue({
      data: { notificationId: 'n1', type: 'ROOM_INVITE', roomId: 'room-1' },
    });

    await expect(getInitialNotificationDeepLink()).resolves.toBe('chathouse://room/room-1');
    expect(getInitialNotifeeMock).not.toHaveBeenCalled();
  });

  it('uses Notifee initial notification when FCM has none', async () => {
    getInitialNotifeeMock.mockResolvedValue({
      notification: {
        data: { notificationId: 'n2', type: 'WAVE', waverId: 'user-4' },
      },
      pressAction: { id: 'default' },
    });

    await expect(getInitialNotificationDeepLink()).resolves.toBe('chathouse://u/user-4');
  });

  it('publishes FCM background-open and Notifee foreground PRESS callbacks', () => {
    const listener = jest.fn();
    const unsubscribeMessaging = jest.fn();
    const unsubscribeNotifee = jest.fn();
    let onFcmOpen: ((message: { data?: Record<string, string> }) => void) | undefined;
    let onNotifeeEvent:
      | ((event: {
          type: EventType;
          detail: { notification?: { data?: Record<string, string> } };
        }) => void)
      | undefined;

    onNotificationOpenedAppMock.mockImplementation(callback => {
      onFcmOpen = callback;
      return unsubscribeMessaging;
    });
    onForegroundEventMock.mockImplementation(callback => {
      onNotifeeEvent = callback;
      return unsubscribeNotifee;
    });

    const unsubscribe = subscribeToNotificationDeepLinks(listener);
    onFcmOpen?.({ data: { notificationId: 'n3', type: 'ROOM_STARTED', roomId: 'r3' } });
    onNotifeeEvent?.({
      type: EventType.PRESS,
      detail: {
        notification: {
          data: { notificationId: 'n4', type: 'NEW_MESSAGE', senderId: 'u4' },
        },
      },
    });
    onNotifeeEvent?.({
      type: EventType.DELIVERED,
      detail: { notification: { data: { notificationId: 'ignored', roomId: 'r5' } } },
    });

    expect(listener).toHaveBeenNthCalledWith(1, 'chathouse://room/r3');
    expect(listener).toHaveBeenNthCalledWith(2, 'chathouse://chat/u4');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(unsubscribeMessaging).toHaveBeenCalledTimes(1);
    expect(unsubscribeNotifee).toHaveBeenCalledTimes(1);
  });

  it('queues a Notifee background press until navigation subscribes and deduplicates it', async () => {
    const event = {
      type: EventType.PRESS,
      detail: {
        notification: {
          data: { notificationId: 'n5', type: 'ROOM_INVITE', roomId: 'r5' },
        },
      },
    };
    await handleBackgroundNotificationEvent(event);
    // Same OS tap can also be observed by FCM. It must not create a second
    // navigation action.
    await handleBackgroundNotificationEvent(event);

    const listener = jest.fn();
    const unsubscribe = subscribeToNotificationDeepLinks(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('chathouse://room/r5');
    unsubscribe();
  });
});
