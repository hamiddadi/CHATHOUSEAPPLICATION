import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { i18n } from '../../../../core/i18n';
import type { RoomParticipant } from '../../../../shared/types/domain';
import { renderScreen } from '../../../../test-utils/renderScreen';
import { speakInviteApi } from '../../../extensions';
import { roomService } from '../../services/roomService';
import { HostActionsSheet } from './HostActionsSheet';

type AlertButton = { style?: string; onPress?: () => void };

const makeTarget = (overrides: Partial<RoomParticipant> = {}): RoomParticipant => ({
  id: 'participant-1',
  username: 'speaker',
  displayName: 'Test Speaker',
  avatarUrl: null,
  role: 'speaker',
  audio: 'idle',
  handRaised: false,
  ...overrides,
});

const renderSheet = (target = makeTarget()) => {
  const onClose = jest.fn();
  const result = renderScreen(
    <HostActionsSheet target={target} roomId="room-1" viewerIsHost onClose={onClose} />,
  );
  return { ...result, onClose };
};

describe('HostActionsSheet', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('closes only after a successful action', async () => {
    const muteSpy = jest.spyOn(roomService, 'setMute').mockResolvedValue({ isMuted: true });
    const { getByLabelText, onClose } = renderSheet();

    fireEvent.press(getByLabelText('Mute microphone'));

    await waitFor(() => expect(muteSpy).toHaveBeenCalledWith('room-1', true, 'participant-1'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows a localized API error and keeps the sheet open when an action fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(roomService, 'setMute').mockRejectedValue({});
    const { getByLabelText, getByText, onClose } = renderSheet();

    fireEvent.press(getByLabelText('Mute microphone'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(i18n.t('common.error'), i18n.t('common.actionFailed')),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(getByText('Test Speaker')).toBeTruthy();
    await waitFor(() =>
      expect(getByLabelText('Mute microphone').props.accessibilityState.disabled).toBe(false),
    );
  });

  it('disables controls and synchronously blocks duplicate submissions while pending', async () => {
    let resolveRequest!: (value: { isMuted: boolean }) => void;
    const request = new Promise<{ isMuted: boolean }>(resolve => {
      resolveRequest = resolve;
    });
    const muteSpy = jest.spyOn(roomService, 'setMute').mockReturnValue(request);
    const { getByLabelText, onClose } = renderSheet();

    const muteButton = getByLabelText('Mute microphone');
    fireEvent.press(muteButton);
    fireEvent.press(muteButton);

    await waitFor(() => expect(muteSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(getByLabelText('Mute microphone').props.accessibilityState.disabled).toBe(true);
      expect(getByLabelText('Cancel').props.accessibilityState.disabled).toBe(true);
    });

    resolveRequest({ isMuted: true });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the sheet open when a confirmed kick fails and ignores a double confirm', async () => {
    let confirmButton: AlertButton | undefined;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      if (buttons) {
        confirmButton = (buttons as AlertButton[]).find(button => button.style === 'destructive');
      }
    });
    const kickSpy = jest.spyOn(roomService, 'kick').mockRejectedValue({});
    const { getByLabelText, getByText, onClose } = renderSheet();

    fireEvent.press(getByLabelText('Remove (30-minute ban)'));
    expect(confirmButton).toBeDefined();

    act(() => {
      confirmButton?.onPress?.();
      confirmButton?.onPress?.();
    });

    await waitFor(() =>
      expect(kickSpy).toHaveBeenCalledWith('room-1', 'participant-1', { banMinutes: 30 }),
    );
    expect(kickSpy).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(alertSpy).toHaveBeenLastCalledWith(
        i18n.t('common.error'),
        i18n.t('common.actionFailed'),
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(getByText('Test Speaker')).toBeTruthy();
  });

  it('does not close when a speaking invitation fails', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const inviteSpy = jest.spyOn(speakInviteApi, 'invite').mockRejectedValue({});
    const { getByLabelText, onClose } = renderSheet(
      makeTarget({ role: 'listener', audio: 'idle' }),
    );

    fireEvent.press(getByLabelText('Nominate to speak (request)'));

    await waitFor(() => expect(inviteSpy).toHaveBeenCalledWith('room-1', 'participant-1'));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(i18n.t('common.error'), i18n.t('common.actionFailed')),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('localizes action rows and confirmation dialogs in French', async () => {
    await i18n.changeLanguage('fr');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = renderSheet();

    expect(getByLabelText('Couper son micro')).toBeTruthy();
    fireEvent.press(getByLabelText("Transférer le rôle d'hôte"));

    expect(alertSpy).toHaveBeenCalledWith(
      'Transférer la room',
      "Donner le rôle d'hôte à @speaker ? Vous deviendrez speaker.",
      expect.arrayContaining([
        expect.objectContaining({ text: 'Annuler', style: 'cancel' }),
        expect.objectContaining({ text: 'Transférer', style: 'destructive' }),
      ]),
    );
  });
});
