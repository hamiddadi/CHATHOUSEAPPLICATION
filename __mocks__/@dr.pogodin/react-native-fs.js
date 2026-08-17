// Manual Jest mock for @dr.pogodin/react-native-fs. The package ships an ESM
// native bridge that cannot run in Jest; focused tests can override the spies.
module.exports = {
  CachesDirectoryPath: '/private-cache',
  writeFile: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
};
