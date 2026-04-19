import type { StyleProp, ViewStyle, ImageStyle } from 'react-native';

export type AvatarSize =
  | 'xs' // 24
  | 'sm' // 32
  | 'md' // 44  (default)
  | 'lg' // 56
  | 'xl' // 72
  | 'xxl'; // 96

export type AvatarShape = 'circle' | 'rounded' | 'squircle';

export type AvatarStatus = 'online' | 'speaking' | 'muted' | 'offline' | 'none';

export interface AvatarProps {
  /** Remote image URL. */
  uri?: string | null;

  /** Full name — used to derive initials when no image is available. */
  name?: string;

  /** Visual size token. Defaults to 'md'. */
  size?: AvatarSize;

  /** Numeric pixel size (overrides `size` token). */
  sizeValue?: number;

  /** Shape of the avatar. Defaults to 'circle'. */
  shape?: AvatarShape;

  /** Presence/state indicator badge. */
  status?: AvatarStatus;

  /** Optional ring around the avatar (e.g. speaker glow). */
  ring?: boolean;
  ringColor?: string;
  ringWidth?: number;

  /** Makes the avatar pressable. */
  onPress?: () => void;

  /** Accessibility label (defaults to name). */
  accessibilityLabel?: string;

  testID?: string;

  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
}
