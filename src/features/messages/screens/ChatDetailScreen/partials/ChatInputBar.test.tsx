/**
 * Unit test for ChatInputBar's length guard: the TextInput caps at the backend
 * limit (2000) and a discrete counter only appears as the draft nears it.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import ChatInputBar from './ChatInputBar';

const baseProps = {
  onChangeText: jest.fn(),
  onSend: jest.fn(),
  canSend: false,
  bottomInset: 0,
  keyboardVisible: false,
  onMic: jest.fn(),
  onInputFocus: jest.fn(),
};

describe('ChatInputBar length guard', () => {
  it('caps the input at 2000 characters (backend limit)', () => {
    const { getByPlaceholderText } = render(<ChatInputBar {...baseProps} value="" />);
    const input = getByPlaceholderText('Type a message…');
    expect(input.props.maxLength).toBe(2000);
  });

  it('hides the counter for a short draft', () => {
    const { queryByText } = render(<ChatInputBar {...baseProps} value="hello" />);
    expect(queryByText(/\/2000$/)).toBeNull();
  });

  it('shows the counter once the draft nears the limit', () => {
    const nearLimit = 'x'.repeat(1950);
    const { getByText } = render(<ChatInputBar {...baseProps} value={nearLimit} />);
    expect(getByText('1950/2000')).toBeTruthy();
  });
});
