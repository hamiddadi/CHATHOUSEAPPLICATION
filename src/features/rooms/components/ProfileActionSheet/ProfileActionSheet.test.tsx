import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, waitFor } from '@testing-library/react-native';
import type { UserSummary } from '../../../../shared/types/domain';
import { renderScreen } from '../../../../test-utils/renderScreen';
import { messageService } from '../../../messages/services/messageService';
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

  afterEach(() => {
    jest.restoreAllMocks();
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

  it('sends a localized room link and confirms it with localized copy', async () => {
    mockExternalPurchasesAllowed.mockReturnValue(false);
    const sendSpy = jest.spyOn(messageService, 'send').mockResolvedValue({} as never);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onClose = jest.fn();
    const { getByText } = renderScreen(
      <ProfileActionSheet target={target} roomId="room-1" viewerId="viewer-1" onClose={onClose} />,
    );

    fireEvent.press(getByText('Share this room'));

    await waitFor(() => {
      expect(sendSpy).toHaveBeenCalledWith(
        'creator-1',
        'Join me on ChatHouse 👉 https://app.chathouse.com/room/room-1',
      );
      expect(alertSpy).toHaveBeenCalledWith('Link sent', '@creator received the room link.');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
