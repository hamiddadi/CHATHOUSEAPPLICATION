/**
 * Self-contained mock for react-native-reanimated v4.
 *
 * The library's own `react-native-reanimated/mock` re-imports the real package,
 * which initialises react-native-worklets' native module and throws under jest
 * ("Native part of Worklets doesn't seem to be initialized"). This mock has no
 * real reanimated dependency: shared values become plain refs, animation
 * helpers are identity functions, worklets run inline, and Animated.* / layout
 * animations render as plain RN components. Covers the full surface the app
 * imports: useAnimatedStyle, useSharedValue, withTiming, withSpring, withRepeat,
 * withSequence, withDelay, cancelAnimation, runOnJS, Easing + FadeIn/FadeOut
 * layout animations.
 */
const React = require('react');
const RN = require('react-native');

// --- shared values & hooks ------------------------------------------------
const useSharedValue = (init) => {
  const ref = React.useRef(undefined);
  if (ref.current === undefined) ref.current = { value: init };
  return ref.current;
};

const useAnimatedStyle = (factory) => {
  try {
    return factory() || {};
  } catch {
    return {};
  }
};

const useDerivedValue = (factory) => {
  const ref = React.useRef({ value: undefined });
  try {
    ref.current.value = factory();
  } catch {
    /* ignore */
  }
  return ref.current;
};

const useAnimatedRef = () => React.useRef(null);
const useAnimatedScrollHandler = () => () => {};
const useAnimatedReaction = () => {};
const useAnimatedProps = (factory) => {
  try {
    return factory() || {};
  } catch {
    return {};
  }
};

// --- animation helpers (all collapse to the target value) -----------------
const withTiming = (toValue) => toValue;
const withSpring = (toValue) => toValue;
const withDecay = (_config) => 0;
const withDelay = (_delay, animation) => animation;
const withRepeat = (animation) => animation;
const withSequence = (...animations) => animations[animations.length - 1];
const cancelAnimation = () => {};

// --- worklet schedulers (run inline) --------------------------------------
const runOnJS =
  (fn) =>
  (...args) =>
    typeof fn === 'function' ? fn(...args) : undefined;
const runOnUI =
  (fn) =>
  (...args) =>
    typeof fn === 'function' ? fn(...args) : undefined;
const runOnRuntime =
  () =>
  (fn) =>
  (...args) =>
    typeof fn === 'function' ? fn(...args) : undefined;

// --- math / interpolation -------------------------------------------------
const interpolate = (x) => x;
const interpolateColor = () => 'rgba(0, 0, 0, 1)';
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const measure = () => null;
const scrollTo = () => {};
const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };
const Extrapolate = Extrapolation;
const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' };

// Easing: every property is a callable that returns itself, so chains like
// Easing.inOut(Easing.ease) resolve without error.
const noopEasing = (..._args) => noopEasing;
const Easing = new Proxy(
  {},
  {
    get: () => noopEasing,
  },
);

// --- Animated components --------------------------------------------------
const ANIMATION_PROPS = ['entering', 'exiting', 'layout', 'sharedTransitionTag', 'animatedProps'];
const makeAnimated = (Component) => {
  const Wrapped = React.forwardRef((props, ref) => {
    const rest = { ...props };
    ANIMATION_PROPS.forEach((p) => delete rest[p]);
    return React.createElement(Component, { ref, ...rest });
  });
  Wrapped.displayName = `Animated.${Component.displayName || Component.name || 'Component'}`;
  return Wrapped;
};

const createAnimatedComponent = (Component) => makeAnimated(Component);

const Animated = {
  View: makeAnimated(RN.View),
  Text: makeAnimated(RN.Text),
  ScrollView: makeAnimated(RN.ScrollView),
  Image: makeAnimated(RN.Image),
  FlatList: makeAnimated(RN.FlatList),
  SectionList: makeAnimated(RN.SectionList),
  createAnimatedComponent,
};

// --- layout animations (FadeInDown, SlideOutUp, …) ------------------------
// Builder is callable + chainable for static methods (.duration/.delay/…).
const makeLayoutBuilder = () =>
  new Proxy(function () {}, {
    get: () => () => makeLayoutBuilder(),
    apply: () => makeLayoutBuilder(),
  });

const KNOWN_EXPORTS = {
  __esModule: true,
  default: Animated,
  Animated,
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
  withDecay,
  withDelay,
  withRepeat,
  withSequence,
  cancelAnimation,
  runOnJS,
  runOnUI,
  runOnRuntime,
  interpolate,
  interpolateColor,
  clamp,
  measure,
  scrollTo,
  Extrapolation,
  Extrapolate,
  ReduceMotion,
  Easing,
};

// Any other named import (layout animations like FadeInDown, ZoomIn, Keyframe,
// SlideInLeft, …) resolves to a chainable layout builder so screens that use
// them mount without us enumerating every variant.
module.exports = new Proxy(KNOWN_EXPORTS, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop === 'symbol') return undefined;
    return makeLayoutBuilder();
  },
});
