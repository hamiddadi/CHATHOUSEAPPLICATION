// Manual jest mock for react-native-svg. Every SVG primitive (Svg, Path, Rect,
// Circle, Defs, LinearGradient, Stop, G, …) is stubbed as a plain <View> so
// components like GradientView mount without the native SVG renderer. A Proxy
// returns a fresh stub for any name accessed, so we never have to enumerate the
// full surface of the library.
const React = require('react');
const { View } = require('react-native');

const makeStub = name => {
  const Stub = props => React.createElement(View, props, props && props.children);
  Stub.displayName = name;
  return Stub;
};

const Svg = makeStub('Svg');

const cache = new Map();
const handler = {
  get(target, prop) {
    if (prop === 'default') return Svg;
    if (prop === '__esModule') return true;
    if (typeof prop !== 'string') return target[prop];
    if (!cache.has(prop)) cache.set(prop, makeStub(prop));
    return cache.get(prop);
  },
};

module.exports = new Proxy({ default: Svg }, handler);
