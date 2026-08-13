import { colors } from './theme';

interface TailwindColors {
  background: string;
  primary: { DEFAULT: string; container: string };
  'gradient-start': string;
  'gradient-mid': string;
  'gradient-end': string;
}

const tailwindConfig = jest.requireActual<{
  theme: { extend: { colors: TailwindColors } };
}>('../../../tailwind.config.js');

const toRgb = (hex: string): [number, number, number] => {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    ?.map(channel => Number.parseInt(channel, 16));
  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  return [channels[0]!, channels[1]!, channels[2]!];
};

const luminance = ([red, green, blue]: [number, number, number]): number => {
  const [r, g, b] = [red, green, blue].map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

const contrast = (foreground: [number, number, number], background: string): number => {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(toRgb(background));
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

describe('design token synchronization', () => {
  it('keeps NativeWind hero/brand colors aligned with the runtime theme', () => {
    const tailwindColors = tailwindConfig.theme.extend.colors;
    expect(tailwindColors.background).toBe(colors.background);
    expect(tailwindColors.primary.DEFAULT).toBe(colors.primary);
    expect(tailwindColors.primary.container).toBe(colors.primaryContainer);
    expect(tailwindColors['gradient-start']).toBe(colors.gradientStart);
    expect(tailwindColors['gradient-mid']).toBe(colors.gradientMid);
    expect(tailwindColors['gradient-end']).toBe(colors.gradientEnd);
  });

  it('keeps 70% white landing copy AA-readable at the lightest gradient stop', () => {
    const background = toRgb(colors.gradientEnd);
    const translucentWhite = background.map(channel => Math.round(255 * 0.7 + channel * 0.3)) as [
      number,
      number,
      number,
    ];
    expect(contrast(translucentWhite, colors.gradientEnd)).toBeGreaterThanOrEqual(4.5);
  });
});
