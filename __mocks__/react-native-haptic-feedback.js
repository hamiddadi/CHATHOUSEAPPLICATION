// Manual jest mock for react-native-haptic-feedback. `trigger` is a no-op so the
// haptics helpers (impactLight / notifySuccess / selection) don't touch the
// native vibration module.
const trigger = jest.fn();

module.exports = {
  trigger,
  default: { trigger },
};
