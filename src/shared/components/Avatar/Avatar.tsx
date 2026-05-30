import React, { memo, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { cn } from '../../utils/cn';
import { colors } from '../../constants/theme';
import {
  AVATAR_SIZE_MAP,
  INITIALS_FONT_RATIO,
  STATUS_BORDER_RATIO,
  STATUS_DOT_RATIO,
  getFallbackTint,
  getShapeRadius,
  getStatusColor,
} from './Avatar.styles';
import type { AvatarProps } from './types';

const BLURHASH_FALLBACK = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';
/** Emerald accent ring drawn for live speakers and as the default ring tint. */
const SPEAKING_RING_COLOR = colors.accent;

const getInitials = (name?: string): string => {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
};

/**
 * User avatar with automatic fallback to deterministic colored initials.
 *
 * - Image `uri` is optional; when missing or failing to load, renders initials derived from `name`.
 * - Fallback background color is hashed from the seed so the same user always shows the same tint.
 * - `status="speaking"` draws a glowing accent ring (use for live speakers in a room).
 * - Pressable when `onPress` is provided; exposes `accessibilityRole="button"` in that case.
 *
 * Dimensions are dynamic (from `size` token or `sizeValue`) and thus applied inline.
 * Static layout and colors use NativeWind classes.
 *
 * @example
 * <Avatar uri={user.avatarUrl} name={user.name} size="lg" status="speaking" onPress={openProfile} />
 */
export const Avatar: React.FC<AvatarProps> = memo(
  ({
    uri,
    name,
    size = 'md',
    sizeValue,
    shape = 'circle',
    status = 'none',
    ring = false,
    ringColor = SPEAKING_RING_COLOR,
    ringWidth = 2,
    onPress,
    accessibilityLabel,
    testID,
    style,
    imageStyle,
  }) => {
    const [hasError, setHasError] = useState(false);

    const dimension = sizeValue ?? AVATAR_SIZE_MAP[size];
    const radius = getShapeRadius(shape, dimension);
    const initials = useMemo(() => getInitials(name), [name]);
    const tint = useMemo(() => getFallbackTint(name ?? uri ?? undefined), [name, uri]);

    const statusDotSize = Math.round(dimension * STATUS_DOT_RATIO);
    const statusBorder = Math.max(1, Math.round(dimension * STATUS_BORDER_RATIO));

    const showImage = !!uri && !hasError;
    const showRing = ring || status === 'speaking';
    const wrapperSize = showRing ? dimension + ringWidth * 2 : dimension;
    const effectiveRingColor = status === 'speaking' ? SPEAKING_RING_COLOR : ringColor;

    const wrapperDynamicStyle = useMemo(
      () => ({ width: wrapperSize, height: wrapperSize }),
      [wrapperSize],
    );
    const ringDynamicStyle = useMemo(
      () =>
        showRing
          ? {
              padding: ringWidth,
              borderRadius: getShapeRadius(shape, wrapperSize),
              backgroundColor: effectiveRingColor,
            }
          : null,
      [showRing, ringWidth, shape, wrapperSize, effectiveRingColor],
    );

    const content = (
      <View
        className="items-center justify-center"
        style={[wrapperDynamicStyle, ringDynamicStyle, style]}
      >
        <View
          className="items-center justify-center overflow-hidden"
          style={{
            width: dimension,
            height: dimension,
            borderRadius: radius,
            backgroundColor: tint,
          }}
        >
          {showImage && uri ? (
            <Image
              source={{ uri }}
              onError={() => setHasError(true)}
              className="w-full h-full"
              style={[{ borderRadius: radius }, imageStyle]}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
              placeholder={{ blurhash: BLURHASH_FALLBACK }}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text
              className="text-primary-on font-body-bold text-center"
              style={{ fontSize: Math.round(dimension * INITIALS_FONT_RATIO) }}
              allowFontScaling={false}
              numberOfLines={1}
            >
              {initials}
            </Text>
          )}
        </View>

        {status !== 'none' && status !== 'speaking' && (
          <View
            className="absolute right-0 bottom-0 border-background"
            style={{
              width: statusDotSize,
              height: statusDotSize,
              borderRadius: statusDotSize / 2,
              borderWidth: statusBorder,
              backgroundColor: getStatusColor(status),
            }}
          />
        )}
      </View>
    );

    const a11yLabel = accessibilityLabel ?? (name ? `${name} avatar` : 'User avatar');

    if (onPress) {
      return (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          testID={testID}
          hitSlop={8}
          className={cn('active:opacity-85')}
        >
          {content}
        </Pressable>
      );
    }

    return (
      <View accessibilityLabel={a11yLabel} accessible testID={testID}>
        {content}
      </View>
    );
  },
);

Avatar.displayName = 'Avatar';
