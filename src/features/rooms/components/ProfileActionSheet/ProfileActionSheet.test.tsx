import React from 'react';
import type { UserSummary } from '../../../../shared/types/domain';
import { renderScreen } from '../../../../test-utils/renderScreen';
import { ProfileActionSheet } from './ProfileActionSheet';

const mockExternalPurchasesAllowed = jest.fn();

jest.mock('../../../extensions/utils/digitalPurchases', () => ({
  areExternalDigitalPurchasesAllowed: () => mockExternalPurchasesAllowed(),
}));

jest.mock('../../../extensions/hooks/useExtBackend', () => ({
  useExtBackend: () => ({
    status: {
      available: true,
      vaguesMounted: [],
      features: {
        payments: true,
        captions: false,
        twitter: false,
        contacts: false,
      },
    },
    loading: false,
  }),
}));

const target: UserSummary = {
  id: 'creator-1',
  username: 'creator',
  displayName: 'Creator',
  avatarUrl: null,
};

describe('ProfileActionSheet tip entry point', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hides the tip action in mobile store builds even when backend payments are enabled', () => {
    mockExternalPurchasesAllowed.mockReturnValue(false);

    const { queryByText } = renderScreen(
      <ProfileActionSheet
        target={target}
        roomId="room-1"
        viewerId="viewer-1"
        onClose={jest.fn()}
      />,
    );

    expect(queryByText(/Envoyer un pourboire/)).toBeNull();
  });

  it('keeps the tip action on Android when backend payments are enabled', () => {
    mockExternalPurchasesAllowed.mockReturnValue(true);

    const { getByText } = renderScreen(
      <ProfileActionSheet
        target={target}
        roomId="room-1"
        viewerId="viewer-1"
        onClose={jest.fn()}
      />,
    );

    expect(getByText(/Envoyer un pourboire/)).toBeTruthy();
  });

  it('always exposes report and block actions for another participant', () => {
    mockExternalPurchasesAllowed.mockReturnValue(false);

    const { getByText } = renderScreen(
      <ProfileActionSheet
        target={target}
        roomId="room-1"
        viewerId="viewer-1"
        onClose={jest.fn()}
      />,
    );

    expect(getByText('Signaler ce profil')).toBeTruthy();
    expect(getByText('Bloquer ce profil')).toBeTruthy();
  });
});
