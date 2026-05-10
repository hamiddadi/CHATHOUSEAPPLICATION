import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSocketStore } from '../../../shared/services/realtime/socketStore';

/**
 * Small in-room banner shown when the realtime socket is reconnecting.
 * Keep it scoped to audio-room screens — dashboard/feed screens don't need
 * it because they consume REST, not the socket stream.
 */
export const SocketStatusBanner: React.FC = () => {
  const status = useSocketStore(s => s.status);
  const { t } = useTranslation();
  if (status === 'connected' || status === 'idle' || status === 'connecting') return null;

  const label = status === 'reconnecting' ? t('socket.reconnecting') : t('socket.disconnected');

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className="bg-warning/90 px-xxl py-xxs items-center"
    >
      <Text className="text-[11px] font-body-bold text-surface-highest tracking-wide">{label}</Text>
    </View>
  );
};
