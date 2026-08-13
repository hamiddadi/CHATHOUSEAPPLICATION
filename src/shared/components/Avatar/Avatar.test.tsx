import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'react-native';
import { Avatar } from './Avatar';
import { AVATAR_FALLBACK_TINTS, getFallbackForeground, getFallbackTint } from './Avatar.styles';

const luminance = (hex: string): number => {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map(channel => Number.parseInt(channel, 16) / 255)
    .map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
};

const contrast = (foreground: string, background: string): number => {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

describe('Avatar', () => {
  it('renders initials when no uri is provided', () => {
    const { getByText } = render(<Avatar name="Ada Lovelace" />);
    expect(getByText('AL')).toBeTruthy();
  });

  it('renders single-word name initials', () => {
    const { getByText } = render(<Avatar name="Claude" />);
    expect(getByText('CL')).toBeTruthy();
  });

  it('renders nothing as initials for empty name', () => {
    const { queryByText } = render(<Avatar />);
    expect(queryByText(/./)).toBeNull();
  });

  it('is pressable when onPress is provided', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<Avatar name="Grace Hopper" onPress={onPress} />);
    expect(getByLabelText('Grace Hopper avatar')).toBeTruthy();
  });

  it('keeps initials AA-readable on every deterministic fallback tint', () => {
    for (const tint of AVATAR_FALLBACK_TINTS) {
      expect(contrast(getFallbackForeground(tint), tint)).toBeGreaterThanOrEqual(4.5);
    }
    expect(getFallbackTint('Ada Lovelace')).toMatch(/^#/);
  });

  it('retries image rendering when the uri changes after an error', () => {
    const screen = render(<Avatar name="Ada" uri="https://example.com/old.jpg" />);
    fireEvent(screen.UNSAFE_getByType(Image), 'error');
    expect(screen.UNSAFE_queryByType(Image)).toBeNull();

    screen.rerender(<Avatar name="Ada" uri="https://example.com/new.jpg" />);
    expect(screen.UNSAFE_getByType(Image).props.source).toEqual({
      uri: 'https://example.com/new.jpg',
    });
  });
});
