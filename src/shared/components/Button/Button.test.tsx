import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import { Button } from './Button';
import {
  sizeContainerClass,
  sizeHitSlop,
  variantIndicatorColor,
  variantTextClass,
} from './Button.styles';

describe('Button', () => {
  it('renders the label and fires onPress', () => {
    const onPress = jest.fn();
    const { getByText, getByRole } = render(<Button label="Join" onPress={onPress} />);
    expect(getByText('Join')).toBeTruthy();
    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByRole } = render(<Button label="Join" disabled onPress={onPress} />);
    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('uses the high-contrast foreground token for destructive actions', () => {
    expect(variantTextClass.danger).toBe('text-on-danger');
  });

  it('uses a variant-aware spinner color while loading', () => {
    const { UNSAFE_getByType, getByRole } = render(
      <Button label="Delete" variant="danger" loading />,
    );
    expect(UNSAFE_getByType(ActivityIndicator).props.color).toBe(variantIndicatorColor.danger);
    expect(getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(getByRole('button').props.className).not.toContain('opacity-45');
  });

  describe('44pt touch target', () => {
    it('applies a compensating hitSlop on size="sm" so the effective target reaches 44pt', () => {
      const { getByRole } = render(<Button label="Follow" size="sm" onPress={jest.fn()} />);
      // 36px visual min-height + 4px top + 4px bottom = 44px effective.
      expect(getByRole('button').props.hitSlop).toEqual({ top: 4, bottom: 4 });
    });

    it('keeps the sm visual size unchanged (compensation is hitSlop-only)', () => {
      expect(sizeContainerClass.sm).toContain('min-h-[36px]');
      const insets = sizeHitSlop.sm;
      expect(36 + (insets?.top ?? 0) + (insets?.bottom ?? 0)).toBeGreaterThanOrEqual(44);
    });

    it('adds no automatic hitSlop for md/lg (already >=44pt visually)', () => {
      const md = render(<Button label="Join" size="md" onPress={jest.fn()} />);
      expect(md.getByRole('button').props.hitSlop).toBeUndefined();

      const lg = render(<Button label="Join" size="lg" onPress={jest.fn()} />);
      expect(lg.getByRole('button').props.hitSlop).toBeUndefined();
    });

    it('lets a caller-provided hitSlop override the automatic sm one', () => {
      const { getByRole } = render(
        <Button label="Follow" size="sm" hitSlop={12} onPress={jest.fn()} />,
      );
      expect(getByRole('button').props.hitSlop).toBe(12);
    });
  });
});
