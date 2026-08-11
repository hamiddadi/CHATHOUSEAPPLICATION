import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { i18n } from '../../../../core/i18n';
import type { UserSummary } from '../../../../shared/types/domain';
import { renderScreen } from '../../../../test-utils/renderScreen';
import { messageService } from '../../../messages/services/messageService';
import { socialService } from '../../../social/services/socialService';
import { profileService } from '../../../profile/services/profileService';
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
  beforeEach(async () => {
    jest.clearAllMocks();
    await i18n.changeLanguage('en');
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

    expect(queryByText(/Send a tip/)).toBeNull();
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

    expect(getByText(/Send a tip/)).toBeTruthy();
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

    expect(getByText('Report profile')).toBeTruthy();
    expect(getByText('Block profile')).toBeTruthy();
  });

  it('reports a private-account follow as a pending request, not an accepted follow', async () => {
    mockExternalPurchasesAllowed.mockReturnValue(false);
    jest.spyOn(profileService, 'follow').mockResolvedValue({ following: false, requested: true });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onClose = jest.fn();
    const { getByText } = renderScreen(
      <ProfileActionSheet target={target} roomId="room-1" viewerId="viewer-1" onClose={onClose} />,
    );

    fireEvent.press(getByText('Follow'));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'Request sent',
        '@creator can now approve your follow request.',
      ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the cross-platform report sheet instead of an oversized Android alert', async () => {
    mockExternalPurchasesAllowed.mockReturnValue(false);
    const reportSpy = jest
      .spyOn(socialService, 'report')
      .mockResolvedValue({ reportId: 'profile-report-1' });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const onClose = jest.fn();
    const { getByText, getByLabelText } = renderScreen(
      <ProfileActionSheet target={target} roomId="room-1" viewerId="viewer-1" onClose={onClose} />,
    );

    fireEvent.press(getByText('Report profile'));

    expect(alertSpy).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Harassment'));

    await waitFor(() =>
      expect(reportSpy).toHaveBeenCalledWith('creator-1', { reason: 'harassment' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    for (const call of alertSpy.mock.calls) {
      expect(call[2]?.length ?? 0).toBeLessThanOrEqual(3);
    }
  });

  it('localizes the participant actions in French', async () => {
    await i18n.changeLanguage('fr');
    mockExternalPurchasesAllowed.mockReturnValue(false);

    const { getByText } = renderScreen(
      <ProfileActionSheet
        target={target}
        roomId="room-1"
        viewerId="viewer-1"
        onClose={jest.fn()}
      />,
    );

    expect(getByText('Suivre')).toBeTruthy();
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
        expect.stringMatching(/^rn-/),
      );
      expect(alertSpy).toHaveBeenCalledWith('Link sent', '@creator received the room link.');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('turns a same-tick double share press into one DM', async () => {
    mockExternalPurchasesAllowed.mockReturnValue(false);
    let resolveSend!: (value: never) => void;
    const sendSpy = jest
      .spyOn(messageService, 'send')
      .mockReturnValue(new Promise(resolve => (resolveSend = resolve)));
    const { getByText } = renderScreen(
      <ProfileActionSheet
        target={target}
        roomId="room-1"
        viewerId="viewer-1"
        onClose={jest.fn()}
      />,
    );
    const share = getByText('Share this room');

    act(() => {
      fireEvent.press(share);
      fireEvent.press(share);
    });
    await waitFor(() => expect(sendSpy).toHaveBeenCalledTimes(1));
    await act(async () => resolveSend({} as never));
  });
});
