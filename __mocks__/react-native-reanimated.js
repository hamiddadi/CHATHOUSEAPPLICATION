// Manual jest mock for react-native-reanimated (v4). The library's own bundled
// /mock transitively requires the real react-native-worklets native binding
// (createSerializable), which throws under jest — so we hand-stub the surface
// the app actually uses instead. Animated.* components render as their plain RN
// counterparts; hooks/animation builders are synchronous no-ops returning sane
// values, and entering/exiting animation descriptors are inert objects.
const React = require('react');
const { View, Text, ScrollView, FlatList, Image } = require('react-native');

// `createAnimatedComponent` just returns the wrapped component (the animation
// layer is a no-op in tests).
const createAnimatedComponent = Component => Component;

const Animated = {
  View,
  Text,
  ScrollView,
  FlatList,
  Image,
  createAnimatedComponent,
};

// ── Hooks ──────────────────────────────────────────────────────────────────
const useSharedValue = initial => ({ value: initial });
const useAnimatedStyle = factory => {
  try {
    return factory();
  } catch {
    return {};
  }
};
const useDerivedValue = factory => ({ value: typeof factory === 'function' ? factory() : factory });
const useAnimatedRef = () => React.createRef();
const useAnimatedScrollHandler = () => () => undefined;
const useAnimatedReaction = () => undefined;
const useAnimatedProps = factory => {
  try {
    return typeof factory === 'function' ? factory() : {};
  } catch {
    return {};
  }
};

// ── Animation builders — return their target so reads stay deterministic ─────
const withTiming = (toValue, _config, cb) => {
  if (typeof cb === 'function') cb(true);
  return toValue;
};
const withSpring = (toValue, _config, cb) => {
  if (typeof cb === 'function') cb(true);
  return toValue;
};
const withDelay = (_delay, animation) => animation;
const withRepeat = animation => animation;
const withSequence = (...animations) => animations[animations.length - 1];
const withDecay = () => 0;
const cancelAnimation = () => undefined;

// ── Worklet / threading helpers ──────────────────────────────────────────────
const runOnJS =
  fn =>
  (...args) =>
    fn(...args);
const runOnUI =
  fn =>
  (...args) =>
    fn(...args);

// ── Interpolation ────────────────────────────────────────────────────────────
const interpolate = (value, _input, output) => (Array.isArray(output) ? output[0] : value);
const interpolateColor = (_value, _input, output) => (Array.isArray(output) ? output[0] : '#000');
const Extrapolate = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
const Extrapolation = Extrapolate;

// ── Easing — every member is identity-ish so callers can chain freely ────────
const identity = t => t;
const makeEasing = () => identity;
const Easing = {
  linear: identity,
  ease: identity,
  quad: identity,
  cubic: identity,
  poly: makeEasing,
  sin: identity,
  circle: identity,
  exp: identity,
  elastic: makeEasing,
  back: makeEasing,
  bounce: identity,
  bezier: () => ({ factory: () => identity }),
  bezierFn: () => identity,
  in: makeEasing,
  out: makeEasing,
  inOut: makeEasing,
  steps: makeEasing,
};

// ── Layout / entering-exiting animation descriptors ──────────────────────────
// Reanimated exposes these as chainable builder objects (e.g.
// FadeInDown.duration(300).delay(100)). A Proxy returns a chainable stub for
// any property access so screens can decorate `entering`/`exiting` freely.
const makeChainable = () => {
  const handler = {
    get(_target, prop) {
      if (prop === 'build') return () => () => ({ initialValues: {}, animations: {} });
      // Any builder method (duration/delay/springify/withCallback/…) returns
      // the same chainable proxy.
      return () => proxy;
    },
  };
  const proxy = new Proxy(function () {}, handler);
  return proxy;
};

// Common entering/exiting + layout transition descriptors used across screens.
const TRANSITIONS = [
  'FadeIn',
  'FadeInDown',
  'FadeInUp',
  'FadeInLeft',
  'FadeInRight',
  'FadeOut',
  'FadeOutDown',
  'FadeOutUp',
  'FadeOutLeft',
  'FadeOutRight',
  'SlideInDown',
  'SlideInUp',
  'SlideInLeft',
  'SlideInRight',
  'SlideOutDown',
  'SlideOutUp',
  'ZoomIn',
  'ZoomOut',
  'BounceIn',
  'BounceOut',
  'Layout',
  'LinearTransition',
  'CurvedTransition',
  'FadingTransition',
  'SequencedTransition',
  'JumpingTransition',
  'EntryExitTransition',
];
const transitionExports = {};
for (const name of TRANSITIONS) transitionExports[name] = makeChainable();

module.exports = {
  __esModule: true,
  default: Animated,
  ...Animated,
  createAnimatedComponent,
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedReaction,
  useAnimatedProps,
  withTiming,
  withSpring,
  withDelay,
  withRepeat,
  withSequence,
  withDecay,
  cancelAnimation,
  runOnJS,
  runOnUI,
  interpolate,
  interpolateColor,
  Extrapolate,
  Extrapolation,
  Easing,
  measure: () => null,
  scrollTo: () => undefined,
  ...transitionExports,
};
