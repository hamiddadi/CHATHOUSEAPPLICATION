/**
 * Render-test for DataExportScreen. Mounts the GDPR data-export screen and
 * exercises its primary CTA (Generate & share) plus the post-export controls
 * (Copy to clipboard / Clear clipboard) that only appear after a successful
 * export. `privacyService.exportMyData`, `Share.share` and the Clipboard
 * native module are spied so the success path runs deterministically without a
 * network or real native side-effect.
 */
import React from 'react';
import { Alert, Share } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { privacyService } from '../services/privacyService';
import { DataExportScreen } from './DataExportScreen';

const FAKE_ARCHIVE = '{"user":"export","messages":[],"profile":{"id":"user-test-1"}}';

describe('DataExportScreen', () => {
  beforeEach(() => {
    mockAuthenticated();
  });
  afterEach(() => {
    resetAuth();
    jest.restoreAllMocks();
  });

  it('mounts and renders the title + primary export CTA', () => {
    const { getByText, toJSON } = renderScreen(<DataExportScreen />);
    expect(toJSON()).toBeTruthy();
    expect(getByText('Export my data')).toBeTruthy();
    expect(getByText('Generate and share my export')).toBeTruthy();
  });

  it('export CTA calls the service then opens the Share sheet, revealing the Copy button', async () => {
    const exportSpy = jest.spyOn(privacyService, 'exportMyData').mockResolvedValue(FAKE_ARCHIVE);
    const shareSpy = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction' } as never);

    const { getByText } = renderScreen(<DataExportScreen />);
    fireEvent.press(getByText('Generate and share my export'));

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({ message: FAKE_ARCHIVE }));
    // Post-export controls now render (lastBytes !== null).
    await waitFor(() => expect(getByText('Copy to clipboard')).toBeTruthy());
  });

  it('alerts when the export request fails (service rejects)', async () => {
    jest.spyOn(privacyService, 'exportMyData').mockRejectedValue(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByText } = renderScreen(<DataExportScreen />);
    fireEvent.press(getByText('Generate and share my export'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(alertSpy.mock.calls[0]?.[0]).toBe('Error');
  });

  it('Copy then Clear clipboard buttons write to and wipe the native clipboard', async () => {
    jest.spyOn(privacyService, 'exportMyData').mockResolvedValue(FAKE_ARCHIVE);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    const setStringSpy = jest.spyOn(Clipboard, 'setString').mockReturnValue(undefined as never);

    const { getByText } = renderScreen(<DataExportScreen />);

    // 1. Export to populate the in-memory archive + reveal the Copy button.
    fireEvent.press(getByText('Generate and share my export'));
    await waitFor(() => expect(getByText('Copy to clipboard')).toBeTruthy());

    // 2. Copy → writes the full archive, then the Clear button appears.
    fireEvent.press(getByText('Copy to clipboard'));
    await waitFor(() => expect(setStringSpy).toHaveBeenCalledWith(FAKE_ARCHIVE));
    await waitFor(() => expect(getByText('Clear clipboard')).toBeTruthy());

    // 3. Clear → writes an empty string to wipe it.
    fireEvent.press(getByText('Clear clipboard'));
    await waitFor(() => expect(setStringSpy).toHaveBeenCalledWith(''));
  });
});
