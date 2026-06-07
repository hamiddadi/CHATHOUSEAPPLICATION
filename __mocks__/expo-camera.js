const React = require('react');
const { View } = require('react-native');

const CameraView = React.forwardRef(({ children, ...props }, ref) =>
  React.createElement(View, { ref, ...props }, children),
);
CameraView.displayName = 'CameraView';

const useCameraPermissions = () => [
  { granted: true, status: 'granted', canAskAgain: true },
  jest.fn(),
];

module.exports = {
  __esModule: true,
  CameraView,
  Camera: CameraView,
  useCameraPermissions,
  CameraType: { front: 'front', back: 'back' },
};
