import { useEffect, useState } from 'react';
import { PixelRatio } from 'react-native';

/**
 * Dynamic font scale hook (Module 16.2 / ACCESS-004/005).
 *
 * Reads the OS-level font scaling preference (iOS Dynamic Type, Android
 * Settings > Display > Font size) and exposes a multiplier the consumer
 * applies to its own font sizes. Clamped to [0.85, 1.6] so layouts don't
 * implode under extreme accessibility settings.
 */
export const useExtFontScale = (): number => {
  const [scale, setScale] = useState<number>(() => clamp(PixelRatio.getFontScale()));
  useEffect(() => {
    // RN doesn't expose a font-scale change event yet; we poll on focus
    // via Dimensions to catch most cases. Cheap and conservative.
    const id = setInterval(() => {
      const next = clamp(PixelRatio.getFontScale());
      setScale(prev => (Math.abs(prev - next) > 0.01 ? next : prev));
    }, 1500);
    return () => clearInterval(id);
  }, []);
  return scale;
};

const clamp = (n: number): number => Math.min(Math.max(n, 0.85), 1.6);

/**
 * Convenience for consumers that want a scaled font size directly.
 *   const fs = useExtScaledFont(16);
 */
export const useExtScaledFont = (base: number): number => {
  const scale = useExtFontScale();
  return Math.round(base * scale);
};
