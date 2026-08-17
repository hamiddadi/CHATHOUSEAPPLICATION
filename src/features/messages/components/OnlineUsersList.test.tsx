import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen } from '../../../test-utils/renderScreen';
import { OnlineUsersList, type OnlineUser } from './OnlineUsersList';

const onlineUser: OnlineUser = {
  peerId: 'usr_live_007',
  displayName: 'Alexandria',
  avatarUrl: null,
};

describe('OnlineUsersList', () => {
  it('returns the exact backend peer id and exposes full accessible context', () => {
    const onOpenChat = jest.fn();
    const { getByLabelText, getByRole, getByText } = renderScreen(
      <OnlineUsersList users={[onlineUser]} onOpenChat={onOpenChat} />,
    );

    expect(getByRole('header', { name: 'Online' })).toBeTruthy();
    // Visual names stay compact, while assistive technology receives the full
    // untruncated display name and availability hint.
    expect(getByText('Alexand…')).toBeTruthy();
    const item = getByLabelText('Open chat with Alexandria');
    expect(item.props.accessibilityHint).toBe('This person is currently available to chat.');

    fireEvent.press(item);

    expect(onOpenChat).toHaveBeenCalledWith('usr_live_007');
    expect(onOpenChat).toHaveBeenCalledTimes(1);
  });

  it('renders no mock users when the backend list is empty', () => {
    const { toJSON } = renderScreen(<OnlineUsersList users={[]} onOpenChat={jest.fn()} />);

    expect(toJSON()).toBeNull();
  });
});
