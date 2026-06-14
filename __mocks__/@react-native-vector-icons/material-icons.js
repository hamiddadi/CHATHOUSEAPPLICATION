// Manual jest mock for @react-native-vector-icons/material-icons.
// The real module calls createIconSet() which `require()`s a .ttf font asset —
// jest can't transform a binary font, so importing the real package throws.
// We render a plain <Text> carrying the icon name so screens that show an icon
// still mount and the name is queryable in tests.
const React = require('react');
const { Text } = require('react-native');

const Icon = ({ name, ...rest }) =>
  React.createElement(Text, { ...rest, accessibilityRole: rest.accessibilityRole }, name ?? '');
Icon.displayName = 'MaterialIcons';
// Mirror the real static helpers a few call sites may touch.
Icon.getImageSource = jest.fn(async () => ({ uri: 'icon' }));
Icon.getImageSourceSync = jest.fn(() => ({ uri: 'icon' }));
Icon.loadFont = jest.fn(async () => undefined);
Icon.hasIcon = jest.fn(() => true);

module.exports = Icon;
module.exports.default = Icon;
module.exports.MaterialIcons = Icon;
