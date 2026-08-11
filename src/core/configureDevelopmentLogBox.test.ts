import { LogBox } from 'react-native';
import { configureDevelopmentLogBox } from './configureDevelopmentLogBox';

describe('configureDevelopmentLogBox', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ignores only the expected Reanimated reduced-motion notice', () => {
    const ignoreLogs = jest.spyOn(LogBox, 'ignoreLogs').mockImplementation(() => undefined);
    const ignoreAllLogs = jest.spyOn(LogBox, 'ignoreAllLogs').mockImplementation(() => undefined);

    configureDevelopmentLogBox();

    expect(ignoreLogs).toHaveBeenCalledTimes(1);
    expect(ignoreLogs).toHaveBeenCalledWith([
      '[Reanimated] Reduced motion setting is enabled on this device.',
    ]);
    expect(ignoreAllLogs).not.toHaveBeenCalled();
  });
});
