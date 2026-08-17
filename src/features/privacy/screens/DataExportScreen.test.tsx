import React from 'react';
import { Alert } from 'react-native';
import NativeShare from 'react-native-share';
import { unlink, writeFile } from '@dr.pogodin/react-native-fs';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderScreen, mockAuthenticated, resetAuth } from '../../../test-utils/renderScreen';
import { privacyService } from '../services/privacyService';
import { DataExportScreen } from './DataExportScreen';

jest.mock('react-native-share', () => ({
  __esModule: true,
  default: { open: jest.fn() },
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  CachesDirectoryPath: '/private-cache',
  writeFile: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
}));

const FAKE_ARCHIVE = '{"user":"export","messages":[],"profile":{"id":"user-test-1"}}';
const openShare = NativeShare.open as jest.Mock;
const writeExportFile = writeFile as jest.Mock;
const unlinkExportFile = unlink as jest.Mock;

describe('DataExportScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('writes a private JSON attachment, shares it, then removes the temporary file', async () => {
    const exportSpy = jest.spyOn(privacyService, 'exportMyData').mockResolvedValue(FAKE_ARCHIVE);
    openShare.mockResolvedValue({ success: true, message: 'shared' });

    const { getByText } = renderScreen(<DataExportScreen />);
    fireEvent.press(getByText('Generate and share my export'));

    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(writeExportFile).toHaveBeenCalledWith(
        expect.stringMatching(/^\/private-cache\/chathouse-export-\d{4}-\d{2}-\d{2}\.json$/),
        FAKE_ARCHIVE,
        'utf8',
      ),
    );
    expect(openShare).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringMatching(/^file:\/\/\/private-cache\/chathouse-export-/),
        type: 'application/json',
        failOnCancel: false,
        useInternalStorage: true,
      }),
    );
    await waitFor(() => expect(unlinkExportFile).toHaveBeenCalledTimes(1));
    expect(getByText(/JSON export shared/)).toBeTruthy();
  });

  it('does not report success when the share sheet is dismissed', async () => {
    jest.spyOn(privacyService, 'exportMyData').mockResolvedValue(FAKE_ARCHIVE);
    openShare.mockResolvedValue({ success: false, message: 'dismissed', dismissedAction: true });

    const { getByText, queryByText } = renderScreen(<DataExportScreen />);
    fireEvent.press(getByText('Generate and share my export'));

    await waitFor(() => expect(openShare).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(unlinkExportFile).toHaveBeenCalledTimes(1));
    expect(queryByText(/JSON export shared/)).toBeNull();
  });

  it('alerts on failure and still removes a file that was already written', async () => {
    jest.spyOn(privacyService, 'exportMyData').mockResolvedValue(FAKE_ARCHIVE);
    openShare.mockRejectedValue(new Error('share failed'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByText } = renderScreen(<DataExportScreen />);
    fireEvent.press(getByText('Generate and share my export'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(alertSpy.mock.calls[0]?.[0]).toBe('Error');
    expect(unlinkExportFile).toHaveBeenCalledTimes(1);
  });

  it('alerts without attempting cleanup when the export request itself fails', async () => {
    jest.spyOn(privacyService, 'exportMyData').mockRejectedValue(new Error('boom'));
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByText } = renderScreen(<DataExportScreen />);
    fireEvent.press(getByText('Generate and share my export'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(writeExportFile).not.toHaveBeenCalled();
    expect(unlinkExportFile).not.toHaveBeenCalled();
  });
});
