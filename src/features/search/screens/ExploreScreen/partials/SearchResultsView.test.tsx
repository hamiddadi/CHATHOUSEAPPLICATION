import React from 'react';
import { ScrollView } from 'react-native';
import type { TFunction } from 'i18next';
import { renderScreen } from '../../../../../test-utils/renderScreen';
import { SearchResultsView } from './SearchResultsView';

const t = ((key: string) => (key === 'explore.searchResults' ? 'Results' : key)) as TFunction;

describe('SearchResultsView', () => {
  it('keeps result taps active and gives incremental loading an accessible name', () => {
    const { getByRole, UNSAFE_getByType } = renderScreen(
      <SearchResultsView
        data={{ users: [], clubs: [], rooms: [] }}
        debouncedQuery="chat"
        isFetching
        bottomInset={0}
        goUser={jest.fn()}
        goClub={jest.fn()}
        goRoom={jest.fn()}
        goTopic={jest.fn()}
        t={t}
      />,
    );

    expect(UNSAFE_getByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
    const progressbar = getByRole('progressbar');
    expect(progressbar).toHaveProp('accessibilityLabel', 'Results');
    expect(progressbar.props.accessibilityState).toEqual({ busy: true });
  });
});
