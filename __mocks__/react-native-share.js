// Manual Jest mock for react-native-share. Importing the real package eagerly
// resolves RNShare through TurboModuleRegistry, which is unavailable in Jest.
// Default to a dismissed sheet; focused tests can override `open` per case.
module.exports = {
  __esModule: true,
  default: {
    open: jest.fn(async () => ({
      success: false,
      message: 'dismissed',
      dismissedAction: true,
    })),
  },
};
