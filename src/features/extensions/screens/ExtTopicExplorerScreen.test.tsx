import React from 'react';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { useExtTopicsTree, useExtTopicsFlat } from '../hooks/useTopics';
import type { Topic, FlatTopic } from '../api/topicsApi';
import { ExtTopicExplorerScreen } from './ExtTopicExplorerScreen';

jest.mock('../hooks/useTopics', () => {
  const actual = jest.requireActual('../hooks/useTopics');
  return {
    ...actual,
    useExtTopicsTree: jest.fn(),
    useExtTopicsFlat: jest.fn(),
  };
});

const mockUseTree = useExtTopicsTree as unknown as jest.Mock;
const mockUseFlat = useExtTopicsFlat as unknown as jest.Mock;

type QueryStub = {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
  isRefetching: boolean;
  isFetching: boolean;
};

const queryState = (over: Partial<QueryStub> = {}): QueryStub => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  isRefetching: false,
  isFetching: false,
  ...over,
});

const tech: Topic = {
  slug: 'tech',
  label: 'Technology',
  emoji: '💻',
  children: [
    { slug: 'ai', label: 'Artificial Intelligence', emoji: '🤖' },
    { slug: 'web', label: 'Web Development', emoji: '🌐' },
  ],
};

const arts: Topic = {
  slug: 'arts',
  label: 'Arts',
  emoji: '🎨',
  children: [{ slug: 'music', label: 'Music', emoji: '🎵' }],
};

const treeData = { topics: [tech, arts], total: 2 };

const flatResults: FlatTopic[] = [
  { slug: 'ai', label: 'Artificial Intelligence', emoji: '🤖', parent: 'tech' },
];

describe('ExtTopicExplorerScreen', () => {
  beforeEach(() => {
    mockUseTree.mockReset();
    mockUseFlat.mockReset();
    mockUseFlat.mockReturnValue(queryState({ data: [] }));
  });

  it('renders the title and search field', () => {
    mockUseTree.mockReturnValue(queryState({ data: treeData }));
    renderScreen(<ExtTopicExplorerScreen />);
    expect(screen.getByText(i18n.t('extensions.topics.title'))).toBeTruthy();
    expect(screen.getByLabelText(i18n.t('extensions.topics.searchA11y'))).toBeTruthy();
  });

  it('shows a loader while the tree is loading', () => {
    mockUseTree.mockReturnValue(queryState({ isLoading: true }));
    renderScreen(<ExtTopicExplorerScreen />);
    // While loading, neither the two-pane empty placeholder nor any topic renders.
    expect(screen.queryByText(i18n.t('extensions.topics.empty'))).toBeNull();
    expect(screen.queryByText('Technology')).toBeNull();
  });

  it('shows the empty placeholder before a category is picked', () => {
    mockUseTree.mockReturnValue(queryState({ data: treeData }));
    renderScreen(<ExtTopicExplorerScreen />);
    expect(screen.getByText(i18n.t('extensions.topics.empty'))).toBeTruthy();
  });

  it('reveals sub-topics after pressing a parent category', async () => {
    mockUseTree.mockReturnValue(queryState({ data: treeData }));
    renderScreen(<ExtTopicExplorerScreen />);

    fireEvent.press(screen.getByText('Technology'));

    expect(await screen.findByText('Artificial Intelligence')).toBeTruthy();
    expect(screen.getByText('Web Development')).toBeTruthy();
  });

  it('calls onSelectTopic with the slug when a sub-topic is pressed', async () => {
    mockUseTree.mockReturnValue(queryState({ data: treeData }));
    const onSelectTopic = jest.fn();
    renderScreen(<ExtTopicExplorerScreen onSelectTopic={onSelectTopic} />);

    fireEvent.press(screen.getByText('Technology'));
    fireEvent.press(await screen.findByText('Web Development'));

    expect(onSelectTopic).toHaveBeenCalledWith('web');
  });

  it('switches to the flat search results when typing a query', async () => {
    mockUseTree.mockReturnValue(queryState({ data: treeData }));
    mockUseFlat.mockReturnValue(queryState({ data: flatResults }));
    const onSelectTopic = jest.fn();
    renderScreen(<ExtTopicExplorerScreen onSelectTopic={onSelectTopic} />);

    fireEvent.changeText(screen.getByLabelText(i18n.t('extensions.topics.searchA11y')), 'intelli');

    const row = await screen.findByText('Artificial Intelligence');
    fireEvent.press(row);

    await waitFor(() => expect(onSelectTopic).toHaveBeenCalledWith('ai'));
  });
});
