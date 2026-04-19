import React, { forwardRef, useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { TextInput as RNTextInput } from 'react-native';
import { cn } from '../../utils/cn';
import { sizeContainerClass, sizeInputClass } from './Input.styles';
import type { InputProps } from './types';

const PLACEHOLDER_COLOR = '#c2c6d7';

/**
 * Text input with label / helper / error states and optional adornments.
 *
 * - `variant="filled"` (default) uses the elevated surface; `outlined` uses the glass look.
 * - Controlled focus state drives the accent border; the error prop takes precedence visually.
 * - Forwards its ref so callers can call `.focus()` imperatively (e.g. after OTP digit entry).
 * - `leftAdornment` / `rightAdornment` are rendered inline — use them for icons or clear buttons.
 *
 * @example
 * <Input label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={err} />
 */
export const Input = forwardRef<RNTextInput, InputProps>(
  (
    {
      label,
      helperText,
      error,
      size = 'md',
      leftAdornment,
      rightAdornment,
      containerStyle,
      inputStyle,
      variant = 'filled',
      onFocus,
      onBlur,
      placeholderTextColor,
      ...inputProps
    },
    ref,
  ) => {
    const [isFocused, setIsFocused] = useState(false);

    const handleFocus = useCallback(
      (e: Parameters<NonNullable<typeof onFocus>>[0]) => {
        setIsFocused(true);
        onFocus?.(e);
      },
      [onFocus],
    );

    const handleBlur = useCallback(
      (e: Parameters<NonNullable<typeof onBlur>>[0]) => {
        setIsFocused(false);
        onBlur?.(e);
      },
      [onBlur],
    );

    return (
      <View className="gap-xs">
        {label ? (
          <Text className="text-xs text-ink-muted ml-xs font-body-medium">{label}</Text>
        ) : null}

        <View
          style={containerStyle}
          className={cn(
            'flex-row items-center gap-sm rounded-md border',
            sizeContainerClass[size],
            variant === 'filled'
              ? 'bg-surface-high border-transparent'
              : 'bg-glass border-glass-strong',
            isFocused && 'border-primary',
            !!error && 'border-danger',
          )}
        >
          {leftAdornment}
          <TextInput
            ref={ref}
            {...inputProps}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholderTextColor={placeholderTextColor ?? PLACEHOLDER_COLOR}
            style={inputStyle}
            className={cn('flex-1 p-0 m-0 text-ink', sizeInputClass[size])}
          />
          {rightAdornment}
        </View>

        {error ? (
          <Text className="text-xs text-danger ml-xs">{error}</Text>
        ) : helperText ? (
          <Text className="text-xs text-ink-muted ml-xs">{helperText}</Text>
        ) : null}
      </View>
    );
  },
);

Input.displayName = 'Input';
