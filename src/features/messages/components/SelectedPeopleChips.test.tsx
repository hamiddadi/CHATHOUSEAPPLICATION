import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { fireEvent } from '@testing-library/react-native';
import { renderScreen } from '../../../test-utils/renderScreen';
import type { User } from '../../../shared/types/domain';
import { SelectedPeopleChips } from './SelectedPeopleChips';

const PERSON: User = {
  id: 'person-1',
  username: 'ada',
  displayName: 'Ada Lovelace',
  bio: null,
  avatarUrl: null,
  followersCount: 0,
  followingCount: 0,
  isFollowedByMe: false,
  isOnline: false,
  createdAt: new Date(0).toISOString(),
};

describe('SelectedPeopleChips', () => {
  it('does not grow into the candidate list and exposes a 44px remove target', () => {
    const onRemove = jest.fn();
    const { getByLabelText, UNSAFE_getByType } = renderScreen(
      <SelectedPeopleChips people={[PERSON]} onRemove={onRemove} />,
    );

    const scroller = UNSAFE_getByType(ScrollView);
    const remove = getByLabelText('Remove Ada Lovelace');

    expect(StyleSheet.flatten(scroller.props.style)).toMatchObject({
      flexGrow: 0,
      flexShrink: 0,
    });
    expect(StyleSheet.flatten(remove.props.style)).toMatchObject({ minHeight: 44 });

    fireEvent.press(remove);
    expect(onRemove).toHaveBeenCalledWith(PERSON);
  });
});
