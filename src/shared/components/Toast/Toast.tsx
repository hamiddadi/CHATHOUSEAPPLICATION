import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore, type Toast as ToastMessage } from './toastStore';

const TOAST_HEIGHT_ESTIMATE = 64;
const IN_DURATION = 220;
const OUT_DURATION = 180;

interface ToastItemProps {
  toast: ToastMessage;
}

const toneClass: Record<ToastMessage['tone'], string> = {
  error: 'bg-danger/90',
  success: 'bg-accent/90',
  info: 'bg-surface-highest/90',
  warning: 'bg-warning/90',
};

const textClass: Record<ToastMessage['tone'], string> = {
  error: 'text-white',
  success: 'text-white',
  info: 'text-ink',
  warning: 'text-surface-highest',
};

const ToastItem: React.FC<ToastItemProps> = ({ toast }) => {
  const translateY = useSharedValue(-TOAST_HEIGHT_ESTIMATE);
  const dismiss = useToastStore(s => s.dismiss);
  const dismissedRef = useRef(false);

  useEffect(() => {
    translateY.value = withTiming(0, { duration: IN_DURATION, easing: Easing.out(Easing.quad) });
    const t = setTimeout(() => {
      if (dismissedRef.current) return;
      translateY.value = withTiming(
        -TOAST_HEIGHT_ESTIMATE,
        { duration: OUT_DURATION, easing: Easing.in(Easing.quad) },
        () => runOnJS(dismiss)(toast.id),
      );
    }, toast.duration);
    return () => {
      clearTimeout(t);
      // Cancel any in-flight entry/exit animation so its runOnJS(dismiss)
      // callback can't fire after this item unmounts. `dismiss` is idempotent
      // (filters by id), so a benign double-call stays harmless.
      cancelAnimation(translateY);
    };
  }, [dismiss, toast.duration, toast.id, translateY]);

  const handlePress = () => {
    dismissedRef.current = true;
    translateY.value = withTiming(
      -TOAST_HEIGHT_ESTIMATE,
      { duration: OUT_DURATION, easing: Easing.in(Easing.quad) },
      () => runOnJS(dismiss)(toast.id),
    );
  };

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={style} className="mx-xxl mt-sm">
      <Pressable
        onPress={handlePress}
        accessibilityRole="alert"
        accessibilityLabel={`${toast.tone}: ${toast.message}`}
        className={`${toneClass[toast.tone]} rounded-md p-md flex-row items-center gap-sm`}
      >
        <Text className={`flex-1 text-sm font-body-medium ${textClass[toast.tone]}`}>
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

/**
 * Global toast portal. Mount once near the root (inside SafeAreaProvider).
 * Consumers call `useToastStore.getState().show({ message, tone })`.
 */
export const ToastPortal: React.FC = () => {
  const toasts = useToastStore(s => s.toasts);
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[toastStyles.anchor, { top: insets.top }]}>
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </View>
  );
};

const toastStyles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 9999,
  },
});
