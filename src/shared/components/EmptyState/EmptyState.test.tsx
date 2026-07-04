/**
 * Component test for the shared EmptyState. Covers the retro-compatible
 * action-button API (actionLabel / onAction) added by the QA-audit fix:
 * no button without onAction, `common.retry` fallback label, custom label,
 * press wiring, and children pass-through. i18n is booted by jest-setup with
 * the `en` mock locale, so `common.retry` resolves to "Retry".
 */
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and the optional description', () => {
    const { getByText } = render(<EmptyState title="Nothing here" description="Come back later" />);
    expect(getByText('Nothing here')).toBeTruthy();
    expect(getByText('Come back later')).toBeTruthy();
  });

  it('renders no action button when onAction is not provided (retro-compat)', () => {
    const { queryByRole } = render(<EmptyState title="Nothing here" actionLabel="Retry now" />);
    expect(queryByRole('button')).toBeNull();
  });

  it('renders an accessible button with the common.retry fallback label and fires onAction', () => {
    const onAction = jest.fn();
    const { getByRole, getByText } = render(<EmptyState title="Oops" onAction={onAction} />);
    expect(getByText('Retry')).toBeTruthy();
    fireEvent.press(getByRole('button'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('uses the provided actionLabel instead of the fallback', () => {
    const onAction = jest.fn();
    const { getByText, queryByText } = render(
      <EmptyState title="Oops" actionLabel="Create a room" onAction={onAction} />,
    );
    expect(getByText('Create a room')).toBeTruthy();
    expect(queryByText('Retry')).toBeNull();
    fireEvent.press(getByText('Create a room'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('still renders children (existing consumers keep their custom CTAs)', () => {
    const { getByText } = render(
      <EmptyState title="Nothing here">
        <Text>Custom CTA</Text>
      </EmptyState>,
    );
    expect(getByText('Custom CTA')).toBeTruthy();
  });
});
