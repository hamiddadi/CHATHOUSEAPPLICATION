/**
 * Unit test for the DM Bubble read-receipt. The blue "done-all" double-check
 * must appear only once the message is actually read (isRead === true); until
 * then a single grey "done" check is shown so we never over-promise a read.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import type { Message } from '../../../../../shared/types/domain';
import Bubble from './Bubble';

const mine = (overrides: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'peer-1',
  authorId: 'me',
  text: 'Hello',
  kind: 'text',
  audioUrl: null,
  durationMs: null,
  sentAt: new Date('2026-07-02T10:30:00Z').toISOString(),
  isMine: true,
  ...overrides,
});

// The mocked @react-native-vector-icons renders the icon `name` as text (see
// __mocks__), so we can assert which check glyph is shown by its name.
describe('Bubble read receipt', () => {
  it('shows the single grey "done" check when the message is unread', () => {
    const { queryByText } = render(
      <Bubble message={mine({ isRead: false })} otherAvatar={null} showAvatar />,
    );
    expect(queryByText('done')).toBeTruthy();
    expect(queryByText('done-all')).toBeNull();
  });

  it('shows the blue "done-all" double-check once the message is read', () => {
    const { queryByText } = render(
      <Bubble message={mine({ isRead: true })} otherAvatar={null} showAvatar />,
    );
    expect(queryByText('done-all')).toBeTruthy();
    expect(queryByText('done')).toBeNull();
  });

  it('treats a missing isRead flag as unread (grey done check)', () => {
    const msg = mine();
    delete (msg as { isRead?: boolean }).isRead;
    const { queryByText } = render(<Bubble message={msg} otherAvatar={null} showAvatar />);
    expect(queryByText('done')).toBeTruthy();
    expect(queryByText('done-all')).toBeNull();
  });
});
