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
});
