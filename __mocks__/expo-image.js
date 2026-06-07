const React = require('react');
const { Image: RNImage } = require('react-native');

const Image = React.forwardRef((props, ref) => React.createElement(RNImage, { ref, ...props }));
Image.displayName = 'Image';

module.exports = { __esModule: true, Image };
