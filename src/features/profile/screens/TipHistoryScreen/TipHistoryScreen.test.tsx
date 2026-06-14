/**
 * Render-test for TipHistoryScreen. Primes the tips query
 * (['ext','payments','tips']) so the list renders sent/received rows, and
 * exercises the back button. Also covers the empty-state branch.
 */
import React from 'react';
import { fireEvent } from '@testing-library/react-native';
import type { TipHistoryItem } from '../../../extensions';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../../test-utils/renderScreen';
import { TipHistoryScreen } from './TipHistoryScreen';

const TIPS_KEY = ['ext', 'payments', 'tips'];

const tips: TipHistoryItem[] = [
  {
    id: 'tip-1',
    direction: 'sent',
    fromUserId: 'user-test-1',
    toUserId: 'user-aaaaaaaa-2',
    amount: 500,
    currency: 'usd',
    createdAt: new Date('2026-01-15T00:00:00.000Z').toISOString(),
  },
  {
    id: 'tip-2',
    direction: 'received',
    fromUserId: 'user-bbbbbbbb-3',
    toUserId: 'user-test-1',
    amount: 1000,
    currency: 'eur',
    createdAt: new Date('2026-02-20T00:00:00.000Z').toISOString(),
  },
];

describe('TipHistoryScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts with primed tips and shows sent + received rows', () => {
    const { getByText, toJSON } = renderScreen(<TipHistoryScreen />, {
      route: { name: 'TipHistory' },
      seedQueryData: [{ key: TIPS_KEY, data: tips }],
    });
    expect(toJSON()).toBeTruthy();
    expect(getByText('Tip history')).toBeTruthy();
    expect(getByText('Tip sent')).toBeTruthy();
    expect(getByText('Tip received')).toBeTruthy();
  });

  it('back button calls navigation.goBack', () => {
    const { getByLabelText, navigation } = renderScreen(<TipHistoryScreen />, {
      route: { name: 'TipHistory' },
      seedQueryData: [{ key: TIPS_KEY, data: tips }],
    });
    fireEvent.press(getByLabelText('Back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state when there are no tips', () => {
    const { getByText } = renderScreen(<TipHistoryScreen />, {
      route: { name: 'TipHistory' },
      seedQueryData: [{ key: TIPS_KEY, data: [] }],
    });
    expect(getByText('No tips yet')).toBeTruthy();
  });
});
