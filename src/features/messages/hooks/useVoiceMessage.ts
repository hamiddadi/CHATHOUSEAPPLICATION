import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useApiErrorToast } from '../../../shared/hooks/useApiErrorToast';
import { voiceService } from '../../../shared/services/api/voiceService';
import { useVoiceRecorder } from './useVoiceRecorder';

type VoiceSender = (audioUrl: string, durationMs: number) => Promise<unknown>;

export interface VoiceMessageComposer {
  /** True while recording, preparing, or uploading — gates the input UI. */
  isActive: boolean;
  isRecording: boolean;
  isUploading: boolean;
  elapsedMs: number;
  startRecording: () => Promise<void>;
  cancelRecording: () => void;
  /** Stop, upload, and send the clip via the injected sender. */
  sendRecording: () => Promise<void>;
}

/**
 * Glue between the recorder, the upload service, and a send mutation. Shared by
 * the 1:1 (ChatDetail) and group (GroupChat) threads — each just passes the
 * right `send` (messageService.sendVoice vs groupService.sendVoice). Surfaces a
 * permission alert and routes upload/send failures through the standard toast.
 */
export const useVoiceMessage = (send: VoiceSender): VoiceMessageComposer => {
  const { t } = useTranslation();
  const toastError = useApiErrorToast();
  const { isRecording, isPreparing, elapsedMs, start, finish, cancel } = useVoiceRecorder();
  const [isUploading, setIsUploading] = useState(false);

  const startRecording = useCallback(async () => {
    const began = await start();
    if (!began) {
      Alert.alert(t('voice.micNeededTitle'), t('voice.micNeededBody'));
    }
  }, [start, t]);

  const cancelRecording = useCallback(() => {
    void cancel();
  }, [cancel]);

  const sendRecording = useCallback(async () => {
    const clip = await finish();
    if (!clip) return;
    setIsUploading(true);
    try {
      const url = await voiceService.upload(clip.uri);
      await send(url, clip.durationMs);
    } catch (err) {
      toastError(err);
    } finally {
      setIsUploading(false);
    }
  }, [finish, send, toastError]);

  return {
    isActive: isRecording || isPreparing || isUploading,
    isRecording,
    isUploading,
    elapsedMs,
    startRecording,
    cancelRecording,
    sendRecording,
  };
};
