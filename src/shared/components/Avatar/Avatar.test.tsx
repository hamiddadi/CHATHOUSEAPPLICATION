import React from 'react';
import { render } from '@testing-library/react-native';
import { Avatar } from './Avatar';

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
});
