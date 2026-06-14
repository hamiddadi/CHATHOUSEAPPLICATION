// Manual jest mock for react-native-image-picker. The picker calls resolve with
// an empty (cancelled) result so callers handle the no-selection path; tests
// that need an asset can override these jest.fns per-case.
module.exports = {
  launchImageLibrary: jest.fn(async () => ({ didCancel: true, assets: [] })),
  launchCamera: jest.fn(async () => ({ didCancel: true, assets: [] })),
};
