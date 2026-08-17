import notifee from '@notifee/react-native';
import { getMessaging, onMessage, type RemoteMessage } from '@react-native-firebase/messaging';
import { ANDROID_CHANNEL_ID, setupForegroundPush } from './pushNotifications';

const onMessageMock = onMessage as jest.Mock;
const createChannelMock = notifee.createChannel as jest.Mock;
const displayNotificationMock = notifee.displayNotification as jest.Mock;

describe('foreground push notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createChannelMock.mockResolvedValue(ANDROID_CHANNEL_ID);
  });

  it('subscribes through the modular Messaging API and renders the received message', async () => {
    const unsubscribe = jest.fn();
    let listener: ((message: RemoteMessage) => Promise<void>) | undefined;
    onMessageMock.mockImplementation(
      (_messaging: unknown, callback: (message: RemoteMessage) => Promise<void>) => {
        listener = callback;
        return unsubscribe;
      },
    );

    expect(setupForegroundPush()).toBe(unsubscribe);
    expect(onMessageMock).toHaveBeenCalledWith(getMessaging(), expect.any(Function));

    expect(listener).toBeDefined();
    await listener?.({
      messageId: 'message-1',
      notification: { title: 'New room', body: 'Join now' },
      data: { roomId: 'room-1' },
      fcmOptions: {},
    });

    expect(displayNotificationMock).toHaveBeenCalledWith({
      title: 'New room',
      body: 'Join now',
      data: { roomId: 'room-1' },
      android: {
        channelId: ANDROID_CHANNEL_ID,
        smallIcon: 'ic_stat_audio',
        pressAction: { id: 'default' },
      },
    });
  });
});
