import { setLiveKitMuted, type LiveKitRoom } from './LiveKitEngine';

const roomWithMicrophone = (setMicrophoneEnabled: jest.Mock): LiveKitRoom =>
  ({
    localParticipant: { setMicrophoneEnabled },
  }) as unknown as LiveKitRoom;

describe('LiveKitEngine microphone publication', () => {
  it('maps muted state to LiveKit microphone enabled state', async () => {
    const setMicrophoneEnabled = jest.fn().mockResolvedValue(undefined);
    const room = roomWithMicrophone(setMicrophoneEnabled);

    await setLiveKitMuted(room, false);
    await setLiveKitMuted(room, true);

    expect(setMicrophoneEnabled).toHaveBeenNthCalledWith(1, true);
    expect(setMicrophoneEnabled).toHaveBeenNthCalledWith(2, false);
  });

  it('propagates a LiveKit publication failure to the caller', async () => {
    const publicationError = Object.assign(new Error('Microphone permission denied'), {
      name: 'NotAllowedError',
    });
    const room = roomWithMicrophone(jest.fn().mockRejectedValue(publicationError));

    await expect(setLiveKitMuted(room, false)).rejects.toBe(publicationError);
  });
});
