import React from 'react';
import { Alert, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { renderScreen, screen, fireEvent, waitFor } from '@/test-utils/renderScreen';
import { i18n } from '@/core/i18n';
import { privacyService } from '../services/privacyService';
import { DataExportScreen } from './DataExportScreen';

// The service hits apiClient/axios (globally inert) — mock it directly so each
// test controls whether the export resolves or rejects, with no network work.
jest.mock('../services/privacyService', () => ({
  privacyService: {
    exportMyData: jest.fn(),
  },
}));

const mockExport = privacyService.exportMyData as jest.Mock;

const ARCHIVE = JSON.stringify({ profile: { id: 'u1' }, messages: [] });

describe('DataExportScreen', () => {
  let shareSpy: jest.SpyInstance;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockExport.mockReset();
    (Clipboard.setStringAsync as jest.Mock).mockClear();
    shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    shareSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('renders without crashing and shows the heading and export button', () => {
    renderScreen(<DataExportScreen />);
    expect(screen.getByText(i18n.t('privacy.export.title'))).toBeTruthy();
    expect(
      screen.getByRole('button', { name: i18n.t('privacy.export.buttonExport') }),
    ).toBeTruthy();
  });

  it('shows the GDPR description and the moderation-exclusion note', () => {
    renderScreen(<DataExportScreen />);
    expect(screen.getByText(i18n.t('privacy.export.description1'))).toBeTruthy();
    expect(screen.getByText(i18n.t('privacy.export.note'))).toBeTruthy();
  });

  it('exports the archive via the Share sheet and reveals the copy controls', async () => {
    mockExport.mockResolvedValue(ARCHIVE);
    renderScreen(<DataExportScreen />);

    fireEvent.press(screen.getByRole('button', { name: i18n.t('privacy.export.buttonExport') }));

    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1));
    expect(shareSpy).toHaveBeenCalledWith({
      message: ARCHIVE,
      title: i18n.t('privacy.export.title'),
    });

    const expectedSize = (ARCHIVE.length / 1024).toFixed(1);
    expect(
      await screen.findByText(i18n.t('privacy.export.success', { size: expectedSize })),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: i18n.t('privacy.export.buttonCopy') })).toBeTruthy();
  });

  it('alerts when the export request fails', async () => {
    mockExport.mockRejectedValue(new Error('boom'));
    renderScreen(<DataExportScreen />);

    fireEvent.press(screen.getByRole('button', { name: i18n.t('privacy.export.buttonExport') }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(alertSpy.mock.calls[0][0]).toBe(i18n.t('privacy.export.errorExportTitle'));
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('copies the archive to the clipboard and then reveals a clear-clipboard button', async () => {
    mockExport.mockResolvedValue(ARCHIVE);
    renderScreen(<DataExportScreen />);

    fireEvent.press(screen.getByRole('button', { name: i18n.t('privacy.export.buttonExport') }));

    const copyButton = await screen.findByRole('button', {
      name: i18n.t('privacy.export.buttonCopy'),
    });
    fireEvent.press(copyButton);

    await waitFor(() =>
      expect(Clipboard.setStringAsync as jest.Mock).toHaveBeenCalledWith(ARCHIVE),
    );
    expect(
      await screen.findByRole('button', { name: i18n.t('privacy.export.buttonClear') }),
    ).toBeTruthy();
  });

  it('clears the clipboard when the clear button is pressed', async () => {
    mockExport.mockResolvedValue(ARCHIVE);
    renderScreen(<DataExportScreen />);

    fireEvent.press(screen.getByRole('button', { name: i18n.t('privacy.export.buttonExport') }));
    fireEvent.press(
      await screen.findByRole('button', { name: i18n.t('privacy.export.buttonCopy') }),
    );

    const clearButton = await screen.findByRole('button', {
      name: i18n.t('privacy.export.buttonClear'),
    });
    fireEvent.press(clearButton);

    await waitFor(() => expect(Clipboard.setStringAsync as jest.Mock).toHaveBeenCalledWith(''));
  });
});
