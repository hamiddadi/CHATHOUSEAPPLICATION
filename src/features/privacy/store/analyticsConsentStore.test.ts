import AsyncStorage from '@react-native-async-storage/async-storage';
import { setReporterEnabled } from '../../../core/observability/reporter';
import { createConsentRecord } from '../consentRecord';
import { useAnalyticsConsentStore } from './analyticsConsentStore';

jest.mock('../../../core/observability/reporter', () => ({
  setReporterEnabled: jest.fn(),
}));

const getItem = AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
const setItem = AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
const setReporter = setReporterEnabled as jest.MockedFunction<typeof setReporterEnabled>;

describe('analyticsConsentStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAnalyticsConsentStore.setState({
      enabled: false,
      recordedAt: null,
      isHydrated: false,
    });
  });

  it('hydrates a current affirmative diagnostics record', async () => {
    const record = createConsentRecord(
      'diagnostics',
      'granted',
      new Date('2026-07-29T12:00:00.000Z'),
    );
    getItem.mockResolvedValue(JSON.stringify(record));

    await useAnalyticsConsentStore.getState().hydrate();

    expect(useAnalyticsConsentStore.getState()).toMatchObject({
      enabled: true,
      recordedAt: record.recordedAt,
      isHydrated: true,
    });
    expect(setReporter).toHaveBeenCalledWith(true);
  });

  it('fails closed for the legacy boolean record', async () => {
    getItem.mockResolvedValue('1');

    await useAnalyticsConsentStore.getState().hydrate();

    expect(useAnalyticsConsentStore.getState()).toMatchObject({
      enabled: false,
      recordedAt: null,
      isHydrated: true,
    });
    expect(setReporter).toHaveBeenCalledWith(false);
  });

  it('persists a timestamped withdrawal before disabling reporting', async () => {
    await useAnalyticsConsentStore.getState().setEnabled(false);

    const written = JSON.parse(setItem.mock.calls[0]?.[1] ?? '{}') as {
      purpose?: string;
      status?: string;
      recordedAt?: string;
    };
    expect(written).toMatchObject({ purpose: 'diagnostics', status: 'denied' });
    expect(Date.parse(written.recordedAt ?? '')).not.toBeNaN();
    expect(setReporter).toHaveBeenCalledWith(false);
  });
});
