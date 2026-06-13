import React, { useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

interface Point {
  x: number;
  y: number;
}

interface GradientViewProps {
  /** Gradient stop colors (top→bottom by default). 2+ entries. */
  colors: readonly string[];
  /** Start point in unit coords (0..1). Default top edge {x:0,y:0}. */
  start?: Point;
  /** End point in unit coords (0..1). Default bottom edge {x:0,y:1}. */
  end?: Point;
  /** Optional explicit stop offsets (0..1), one per color. */
  locations?: readonly number[];
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Drop-in replacement for expo-linear-gradient's `<LinearGradient>` (de-Expo
 * migration). Renders the gradient as an absolutely-positioned react-native-svg
 * fill behind the children: react-native-svg has proper Fabric/new-arch support,
 * whereas react-native-linear-gradient ships no Fabric release (would risk a
 * blank render). Same prop shape (colors / start / end / locations / style +
 * children) so call sites only swap the tag name. `overflow: hidden` clips the
 * fill to the style's borderRadius.
 */
export const GradientView: React.FC<GradientViewProps> = ({
  colors,
  start = { x: 0, y: 0 },
  end = { x: 0, y: 1 },
  locations,
  style,
  children,
}) => {
  const id = `grad-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const lastIndex = Math.max(1, colors.length - 1);
  return (
    <View style={[style, styles.clip]}>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id={id} x1={start.x} y1={start.y} x2={end.x} y2={end.y}>
            {colors.map((color, i) => (
              <Stop key={i} offset={locations?.[i] ?? i / lastIndex} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
