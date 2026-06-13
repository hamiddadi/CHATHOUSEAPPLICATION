import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { create } from 'zustand';

/**
 * Shared single recorder+player instance (de-Expo: replaces the per-component
 * expo-audio `useAudioPlayer` hooks). react-native-audio-recorder-player 3.x is
 * a class, but the native side is a singleton — one instance backs both playback
 * (this store) and recording (useVoiceRecorder), which lets us coordinate the
 * single player across the N chat/replay rows. (4.x's Nitro C++ build fails the
 * ninja/CMake step on Windows, so we stay on the classic-native 3.x line.)
 */
export const audioRecorderPlayer = new AudioRecorderPlayer();

/**
 * Voice-note playback state. The chat `VoiceMessageBubble` and room
 * `ReplayPlayer` rows are thin consumers that derive their own play/progress
 * only when `activeUrl === their url`; selective subscriptions keep inactive
 * rows from re-rendering on the active clip's per-tick updates.
 */
interface VoicePlaybackState {
  activeUrl: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  toggle: (url: string, fallbackDurationMs?: number | null) => Promise<void>;
  stop: () => Promise<void>;
}

export const useVoicePlayback = create<VoicePlaybackState>((set, get) => {
  const stopActive = async (): Promise<void> => {
    audioRecorderPlayer.removePlayBackListener();
    try {
      await audioRecorderPlayer.stopPlayer();
    } catch {
      /* already stopped / nothing loaded — ignore */
    }
  };

  return {
    activeUrl: null,
    playing: false,
    positionMs: 0,
    durationMs: 0,

    toggle: async (url, fallbackDurationMs) => {
      const s = get();
      if (s.activeUrl === url) {
        if (s.playing) {
          try {
            await audioRecorderPlayer.pausePlayer();
          } catch {
            /* ignore */
          }
          set({ playing: false });
          return;
        }
        if (s.positionMs > 0 && s.positionMs < s.durationMs) {
          try {
            await audioRecorderPlayer.resumePlayer();
            set({ playing: true });
            return;
          } catch {
            /* fall through to a fresh start */
          }
        }
      }

      await stopActive();
      set({
        activeUrl: url,
        playing: true,
        positionMs: 0,
        durationMs: fallbackDurationMs ?? 0,
      });
      audioRecorderPlayer.addPlayBackListener(e => {
        // 3.x has no playback-end listener — detect completion via position.
        if (e.duration > 0 && e.currentPosition >= e.duration) {
          audioRecorderPlayer.removePlayBackListener();
          void audioRecorderPlayer.stopPlayer().catch(() => undefined);
          // Keep activeUrl so the finished row stays selected; the next tap
          // restarts from 0 (falls through the resume guard above).
          set({ playing: false, positionMs: 0 });
          return;
        }
        set({ positionMs: e.currentPosition, durationMs: e.duration || get().durationMs });
      });
      try {
        await audioRecorderPlayer.startPlayer(url);
      } catch {
        audioRecorderPlayer.removePlayBackListener();
        set({ activeUrl: null, playing: false, positionMs: 0, durationMs: 0 });
      }
    },

    stop: async () => {
      if (!get().activeUrl) return;
      await stopActive();
      set({ activeUrl: null, playing: false, positionMs: 0, durationMs: 0 });
    },
  };
});
