import { BADGE_META } from './badgesApi';

const relativeLuminance = (hex: string): number => {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)
    ?.map(channel => Number.parseInt(channel, 16) / 255)
    .map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  if (!channels || channels.length !== 3) throw new Error(`Invalid color: ${hex}`);
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
};

const contrastRatio = (foreground: string, background: string): number => {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

describe('BADGE_META', () => {
  it.each(Object.entries(BADGE_META))('%s uses an AA text/background pair', (_name, meta) => {
    expect(contrastRatio(meta.foreground, meta.tone)).toBeGreaterThanOrEqual(4.5);
  });
});
