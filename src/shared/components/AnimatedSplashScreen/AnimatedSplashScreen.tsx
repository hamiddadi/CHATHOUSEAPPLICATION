import React, { useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { colors } from '../../constants/theme';

export const AnimatedSplashScreen: React.FC = () => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.6, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={StyleSheet.absoluteFill} className="bg-background items-center justify-center">
      <Animated.View style={animatedStyle} className="items-center justify-center">
        <View className="bg-primary/10 p-xl rounded-full mb-md">
          <MaterialIcons name="mic" size={64} color={colors.primary} />
        </View>
        <Text className="text-h1 font-display text-ink tracking-widest">CHATHOUSE</Text>
      </Animated.View>
    </View>
  );
};
