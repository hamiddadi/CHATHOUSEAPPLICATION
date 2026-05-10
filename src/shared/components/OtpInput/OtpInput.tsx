import React, { memo, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, radii, spacing } from '../../constants/theme';

const OTP_LENGTH = 6;

interface OtpInputProps {
  value: string;
  onChange: (code: string) => void;
  error?: string;
  autoFocus?: boolean;
}

/**
 * Six separate cells that auto-advance on input, support backspace-to-
 * previous, paste-to-fill, and fire onChange with the full 6-digit string.
 * Uses a single hidden TextInput under the hood — the visible cells are
 * just styled Views — so keyboard handling is native and consistent.
 */
export const OtpInput: React.FC<OtpInputProps> = memo(
  ({ value, onChange, error, autoFocus = true }) => {
    const inputRef = useRef<TextInput>(null);
    const cursor = useSharedValue(1);

    useEffect(() => {
      cursor.value = withRepeat(withTiming(0, { duration: 500 }), -1, true);
    }, [cursor]);

    const handlePress = useCallback(() => {
      inputRef.current?.focus();
    }, []);

    const handleChange = useCallback(
      (text: string) => {
        // Only allow digits, max 6
        const digits = text.replace(/\D/g, '').slice(0, OTP_LENGTH);
        onChange(digits);
      },
      [onChange],
    );

    const cursorStyle = useAnimatedStyle(() => ({
      opacity: cursor.value,
    }));

    const focusedIndex = value.length < OTP_LENGTH ? value.length : OTP_LENGTH - 1;

    return (
      <View>
        <Pressable onPress={handlePress} accessibilityRole="none" style={styles.row}>
          {Array.from({ length: OTP_LENGTH }).map((_, i) => {
            const char = value[i];
            const isFocused = i === focusedIndex && value.length < OTP_LENGTH;
            const hasError = !!error;
            return (
              <View
                key={i}
                style={[
                  styles.cell,
                  isFocused && styles.cellFocused,
                  hasError && styles.cellError,
                  char ? styles.cellFilled : undefined,
                ]}
              >
                {char ? (
                  <Text style={styles.digit}>{char}</Text>
                ) : isFocused ? (
                  <Animated.View style={[styles.cursor, cursorStyle]} />
                ) : null}
              </View>
            );
          })}
        </Pressable>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={handleChange}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          autoFocus={autoFocus}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          style={styles.hidden}
          caretHidden
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  },
);
OtpInput.displayName = 'OtpInput';

export { OtpInput as default };

const CELL_SIZE = 48;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE + 8,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.outline,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(176, 198, 255, 0.08)',
  },
  cellFilled: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(176, 198, 255, 0.12)',
  },
  cellError: {
    borderColor: colors.danger,
  },
  digit: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  cursor: {
    width: 2,
    height: 24,
    backgroundColor: colors.primary,
    borderRadius: 1,
  },
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  error: {
    color: colors.danger,
    fontSize: 12,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
