const React = require('react');
const { View } = require('react-native');

const BlurView = ({ children, ...props }) => React.createElement(View, props, children);

module.exports = { __esModule: true, BlurView };
