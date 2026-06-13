import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { create } from 'zustand';

/**
 * Shared voice-note playback (de-Expo: replaces the per-component expo-audio
 * `useAudioPlayer` hooks). react-native-audio-recorder-player exposes a SINGLE
 * global player, so playback must be coordinated centrally instead of one
 * player per rendered row. This store owns that single player; the chat
 * `VoiceMessageBubble` and room `ReplayPlayer` rows are thin consumers that
 * derive their own play/progress state only when `activeUrl === their url`.
 *
 * Only the active row re-renders on the per-tick position updates (the others
 * select stable values), so an N-row FlatList stays cheap.
 */
interface VoicePlaybackState {
  /** URL of the clip currently loaded into the single player (null = idle). */
  activeUrl: string | null;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  /** Play / pause / resume / restart the given clip on the shared player. */
  toggle: (url: string, fallbackDurationMs?: number | null) => Promise<void>;
  /** Stop and release the active clip (e.g. before recording). */
  stop: () => Promise<void>;
}

export const useVoicePlayback = create<VoicePlaybackState>((set, get) => {
  const detach = (): void => {
    AudioRecorderPlayer.removePlayBackListener();
    AudioRecorderPlayer.removePlaybackEndListener();
  };

  const stopActive = async (): Promise<void> => {
    detach();
    try {
      await AudioRecorderPlayer.stopPlayer();
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
            await AudioRecorderPlayer.pausePlayer();
          } catch {
            /* ignore */
          }
          set({ playing: false });
          return;
        }
        // Paused mid-clip → resume; finished/at-start → fall through to restart.
        if (s.positionMs > 0 && s.positionMs < s.durationMs) {
          try {
            await AudioRecorderPlayer.resumePlayer();
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
      AudioRecorderPlayer.addPlayBackListener(e => {
        set({ positionMs: e.currentPosition, durationMs: e.duration || get().durationMs });
      });
      AudioRecorderPlayer.addPlaybackEndListener(() => {
        detach();
        void AudioRecorderPlayer.stopPlayer().catch(() => undefined);
        // Keep activeUrl so the finished row still shows itself selected; the
        // next tap on it restarts from 0 (falls through the resume guard above).
        set({ playing: false, positionMs: 0 });
      });
      try {
        await AudioRecorderPlayer.startPlayer(url);
      } catch {
        detach();
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
