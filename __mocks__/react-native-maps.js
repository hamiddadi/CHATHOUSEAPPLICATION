/**
 * Manual mock for react-native-maps. Kept as a separate module (not an inline
 * jest.mock factory) so nativewind's babel transform doesn't inject an
 * out-of-scope helper into a hoisted factory. Renders maps as plain Views so
 * map-embedding screens mount under jest; children (Marker/UrlTile) pass
 * through, preserving their accessibilityLabel for assertions.
 */
const React = require('react');
const { View } = require('react-native');

const passthrough = displayName => {
  const C = React.forwardRef(({ children, ...props }, ref) =>
    React.createElement(View, { ref, ...props }, children),
  );
  C.displayName = displayName;
  return C;
};

// MapView exposes imperative methods (animateToRegion, fitToCoordinates, …) via
// a ref. Screens call these from effects/handlers, so the ref must carry them
// rather than being the bare host View.
const MapView = React.forwardRef(({ children, ...props }, ref) => {
  React.useImperativeHandle(ref, () => ({
    animateToRegion: () => {},
    animateCamera: () => {},
    animateToCoordinate: () => {},
    fitToCoordinates: () => {},
    fitToElements: () => {},
    fitToSuppliedMarkers: () => {},
    getCamera: () => Promise.resolve({ center: { latitude: 0, longitude: 0 }, zoom: 10 }),
    setCamera: () => {},
    getMapBoundaries: () => Promise.resolve({ northEast: {}, southWest: {} }),
    pointForCoordinate: () => Promise.resolve({ x: 0, y: 0 }),
    coordinateForPoint: () => Promise.resolve({ latitude: 0, longitude: 0 }),
  }));
  return React.createElement(View, props, children);
});
MapView.displayName = 'MapView';

module.exports = {
  __esModule: true,
  default: MapView,
  MapView,
  Marker: passthrough('Marker'),
  UrlTile: passthrough('UrlTile'),
  Callout: passthrough('Callout'),
  Polygon: passthrough('Polygon'),
  Polyline: passthrough('Polyline'),
  Circle: passthrough('Circle'),
  Overlay: passthrough('Overlay'),
  PROVIDER_GOOGLE: 'google',
  PROVIDER_DEFAULT: undefined,
};
