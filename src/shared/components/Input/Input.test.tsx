import React from 'react';
import { render } from '@testing-library/react-native';
import { Input } from './Input';

describe('Input accessibility', () => {
  it('uses its visible label as the accessible name by default', () => {
    const { getByLabelText } = render(<Input label="Phone number" />);
    expect(getByLabelText('Phone number')).toBeTruthy();
  });

  it('preserves a caller-provided accessible name', () => {
    const { getByLabelText } = render(
      <Input label="Phone" accessibilityLabel="Mobile phone number" />,
    );
    expect(getByLabelText('Mobile phone number')).toBeTruthy();
  });

  it('associates an error hint and announces error changes politely', () => {
    const { getByLabelText, getByText } = render(
      <Input label="Phone" error="Enter a valid number" />,
    );

    expect(getByLabelText('Phone').props.accessibilityHint).toBe('Enter a valid number');
    const error = getByText('Enter a valid number');
    expect(error.props.accessibilityRole).toBe('alert');
    expect(error.props.accessibilityLiveRegion).toBe('polite');
  });
});
