// Manual jest mock for @react-native-vector-icons/fontawesome (see material-icons
// mock for the rationale — the real module requires a binary .ttf font).
const React = require('react');
const { Text } = require('react-native');

const Icon = ({ name, ...rest }) => React.createElement(Text, rest, name ?? '');
Icon.displayName = 'FontAwesome';
Icon.getImageSource = jest.fn(async () => ({ uri: 'icon' }));
Icon.getImageSourceSync = jest.fn(() => ({ uri: 'icon' }));
Icon.loadFont = jest.fn(async () => undefined);
Icon.hasIcon = jest.fn(() => true);

module.exports = Icon;
module.exports.default = Icon;
module.exports.FontAwesome = Icon;
