export { DESIGN_TOKENS } from '../tokens';

export type ReaderThemeEntry = {
  id: number;
  label: string;
  bg: string;
  text: string;
};

export const COLORS = {
  mintGold: '#E8C97A',
  darkCharcoal: '#18191C',
  mediumGray: '#61666D',
  dividerGray: '#E3E5E7',
  pureWhite: '#FFFFFF',
  onDark: '#D4D4D4',
  onLight: '#18191C',
  readerThemes: [
    { id: 0, label: '纯白', bg: '#FFFFFF', text: '#18191C' },
    { id: 1, label: '默认白', bg: '#FFFFFF', text: '#18191C' },
    { id: 2, label: '羊皮纸', bg: '#FBF0D9', text: '#5F4B32' },
    { id: 3, label: '夜间', bg: '#18191C', text: '#D4D4D4' },
    { id: 4, label: '护眼绿', bg: '#E8F5E9', text: '#1B5E20' },
    { id: 5, label: 'OLED', bg: '#000000', text: '#E0E0E0' },
  ] satisfies ReaderThemeEntry[],
  primaryPalette: ['#2563EB', '#7C3AED', '#059669', '#DB2777', '#EA580C'],
  secondaryPalette: ['#3B82F6', '#8B5CF6', '#10B981', '#EC4899', '#F97316'],
  defaultPrimaryIndex: 2,
  defaultSecondaryIndex: 2,
};

export const ON_DARK_INK = '#1A1A1E';
export const ON_LIGHT_INK = '#FFFFFF';

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

export function onColor(hex: string): string {
  return luminance(hex) > 0.5 ? ON_DARK_INK : ON_LIGHT_INK;
}

function toHexByte(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, '0').toUpperCase();
}

function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return b;
  return `#${toHexByte(ca.r + (cb.r - ca.r) * t)}${toHexByte(
    ca.g + (cb.g - ca.g) * t,
  )}${toHexByte(ca.b + (cb.b - ca.b) * t)}`;
}

const GLASS_SURFACE_ALPHA = 0.78;

export function glassTitleColor(bg: string, surface: string): string {
  return onColor(mixHex(bg, surface, GLASS_SURFACE_ALPHA));
}

export function readerTheme(index: number): {
  bg: string;
  text: string;
  label: string;
} {
  const fallback: ReaderThemeEntry = {
    id: 1,
    label: '默认白',
    bg: '#FFFFFF',
    text: '#18191C',
  };
  const entry = COLORS.readerThemes[index] ?? fallback;
  return { bg: entry.bg, text: entry.text, label: entry.label };
}

export const MOTION = {
  fast: 150,
  normal: 250,
  transition: 350,
  sheet: 400,
  headerCollapse: 220,
  easeOut: 'cubic-bezier(0,0,0.58,1)',
  easeInOut: 'cubic-bezier(0.42,0,0.58,1)',
  easeOutQuart: 'cubic-bezier(0.25,1,0.5,1)',
} as const;

export type MotionDuration = (typeof MOTION)[keyof typeof MOTION];
