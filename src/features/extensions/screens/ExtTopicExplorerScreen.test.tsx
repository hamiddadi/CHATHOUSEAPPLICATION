/**
 * Render-test for ExtTopicExplorerScreen. Seeds the topics-tree query so the
 * two-pane explorer renders, then exercises selecting a parent category (left
 * pane → reveals its children on the right) and tapping a sub-topic
 * (onSelectTopic). Native modules are globally mocked in jest-setup.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import { extTopicsTreeKey, type Topic } from '../hooks/useTopics';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { ExtTopicExplorerScreen } from './ExtTopicExplorerScreen';

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
  afterEach(() => resetAuth());

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
});
