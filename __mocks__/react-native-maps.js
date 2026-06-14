// Manual jest mock for react-native-maps. MapView (default), Marker, UrlTile,
// Callout, Polyline, etc. are stubbed as plain <View>s so map screens mount
// without the native map module. Common provider constants are exported too.
//
// MapView forwards a ref exposing the imperative methods screens call inside
// effects (animateToRegion/animateCamera/fitToCoordinates/…). Without these the
// real native handle's methods are absent and `mapRef.current.animateToRegion`
// throws "is not a function" the moment a location fix resolves.
const React = require('react');
const { View } = require('react-native');

const makeStub = name => {
  const Stub = props => React.createElement(View, props, props && props.children);
  Stub.displayName = name;
  return Stub;
};

const MAP_HANDLE_METHODS = [
  'animateToRegion',
  'animateCamera',
  'animateToCoordinate',
  'fitToCoordinates',
  'fitToElements',
  'fitToSuppliedMarkers',
  'setCamera',
  'getMapBoundaries',
  'pointForCoordinate',
  'coordinateForPoint',
  'getMarkersFrames',
];

const MapView = React.forwardRef((props, ref) => {
  React.useImperativeHandle(ref, () => {
    const handle = {};
    for (const name of MAP_HANDLE_METHODS) {
      handle[name] = jest.fn();
    }
    // getCamera is awaited in some screens — resolve a plausible camera.
    handle.getCamera = jest.fn(() =>
      Promise.resolve({ center: { latitude: 0, longitude: 0 }, zoom: 10, heading: 0, pitch: 0 }),
    );
    return handle;
  });
  return React.createElement(View, props, props && props.children);
});
MapView.displayName = 'MapView';

module.exports = MapView;
module.exports.default = MapView;
module.exports.__esModule = true;
module.exports.Marker = makeStub('Marker');
module.exports.Callout = makeStub('Callout');
module.exports.Polyline = makeStub('Polyline');
module.exports.Polygon = makeStub('Polygon');
module.exports.Circle = makeStub('Circle');
module.exports.Overlay = makeStub('Overlay');
module.exports.UrlTile = makeStub('UrlTile');
module.exports.Heatmap = makeStub('Heatmap');
module.exports.PROVIDER_DEFAULT = undefined;
module.exports.PROVIDER_GOOGLE = 'google';
module.exports.Animated = MapView;
