import type { ReactNode } from 'react';
import type { PressableProps, StyleProp, TextStyle, ViewStyle } from 'react-native';

export type ButtonVariant =
  | 'primary' // bg-primary, used for CTAs (Join, Start Room)
  | 'primaryContainer' // bg-primary-container, softer action (Wave)
  | 'ghost' // glass-card, secondary/filter state
  | 'outline' // border only, no fill
  | 'danger'; // leave room, destructive

export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style' | 'disabled'> {
  label?: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}
