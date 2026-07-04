/**
 * Render-test for ExtTopicExplorerScreen. Seeds the topics-tree query so the
 * two-pane explorer renders, then exercises selecting a parent category (left
 * pane → reveals its children on the right) and tapping a sub-topic
 * (onSelectTopic). Native modules are globally mocked in jest-setup.
 */
import React from 'react';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { extTopicsTreeKey, type Topic } from '../hooks/useTopics';
import { topicsApi } from '../api/topicsApi';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { ExtTopicExplorerScreen } from './ExtTopicExplorerScreen';

jest.setTimeout(20000);
const WAIT = { timeout: 8000 } as const;

const TREE: { topics: Topic[]; total: number } = {
  total: 3,
  topics: [
    {
      slug: 'tech',
      label: 'Technology',
      emoji: '💻',
      children: [
        { slug: 'ai', label: 'Artificial Intelligence', emoji: '🤖' },
        { slug: 'web', label: 'Web Dev', emoji: '🌐' },
      ],
    },
    { slug: 'music', label: 'Music', emoji: '🎵', children: [] },
  ],
};

const seed = [{ key: [...extTopicsTreeKey], data: TREE }];

describe('ExtTopicExplorerScreen', () => {
  beforeEach(() => mockAuthenticated());
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with the title and the top-level categories', () => {
    const { getByText, toJSON } = renderScreen(<ExtTopicExplorerScreen />, {
      seedQueryData: seed,
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Explore topics')).toBeTruthy();
    expect(getByText('Technology')).toBeTruthy();
    expect(getByText('Music')).toBeTruthy();
  });

  it('selecting a parent reveals its children, and a child fires onSelectTopic', () => {
    const onSelectTopic = jest.fn();
    const { getByText } = renderScreen(<ExtTopicExplorerScreen onSelectTopic={onSelectTopic} />, {
      seedQueryData: seed,
    });
    // Right pane starts empty until a parent is picked.
    fireEvent.press(getByText('Technology'));
    // Children now render on the right.
    fireEvent.press(getByText('Artificial Intelligence'));
    expect(onSelectTopic).toHaveBeenCalledWith('ai');
  });

  it('typing in the search box does not crash (switches to the flat results view)', () => {
    const { getByLabelText } = renderScreen(<ExtTopicExplorerScreen />, {
      seedQueryData: seed,
    });
    expect(() => fireEvent.changeText(getByLabelText('Search topics'), 'web')).not.toThrow();
  });

  it('shows an error state with a working Retry when the tree fails to load', async () => {
    // Don't seed the cache → the query runs its queryFn, which we make reject
    // so the screen enters its error branch (renderScreen disables retries).
    const treeSpy = jest.spyOn(topicsApi, 'tree').mockRejectedValue(new Error('offline'));
    // Silence the sibling queries (they'd hit the real apiClient otherwise).
    jest.spyOn(topicsApi, 'trending').mockResolvedValue([]);
    jest.spyOn(topicsApi, 'flat').mockResolvedValue([]);
    const { getByText, getByLabelText } = renderScreen(<ExtTopicExplorerScreen />, {});
    await waitFor(() => expect(getByText("Couldn't load topics.")).toBeTruthy(), WAIT);
    // Retry re-runs the query; make it resolve this time.
    treeSpy.mockResolvedValueOnce(TREE);
    fireEvent.press(getByLabelText('Retry'));
    await waitFor(() => expect(getByText('Technology')).toBeTruthy(), WAIT);
    treeSpy.mockRestore();
  });

  it('initialTopic pre-selects the matching parent category (via a child slug)', () => {
    // 'ai' is a child of 'tech' → the left pane should activate 'tech' and the
    // right pane should reveal its children without any user tap.
    const { getByText } = renderScreen(<ExtTopicExplorerScreen initialTopic="ai" />, {
      seedQueryData: seed,
    });
    expect(getByText('Artificial Intelligence')).toBeTruthy();
    expect(getByText('Web Dev')).toBeTruthy();
  });
});
