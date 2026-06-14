// Manual jest mock for @react-native-clipboard/clipboard. Backed by an in-memory
// string so copy/paste round-trips work without the native clipboard.
let value = '';

const Clipboard = {
  getString: jest.fn(async () => value),
  setString: jest.fn(str => {
    value = String(str);
  }),
  hasString: jest.fn(async () => value.length > 0),
  hasURL: jest.fn(async () => false),
  hasNumber: jest.fn(async () => false),
  hasWebURL: jest.fn(async () => false),
};

module.exports = Clipboard;
module.exports.default = Clipboard;
