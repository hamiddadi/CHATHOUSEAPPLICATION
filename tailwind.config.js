/**
 * Tailwind config — mirrors `src/shared/constants/theme.ts`.
 * Keep tokens in sync: if you add a palette entry in theme.ts, add it here too.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // ---- Surfaces (navy / midnight) ----
        background: '#0c112e',
        surface: '#0c112e',
        'surface-alt': '#191d3b',
        'surface-high': '#232846',
        'surface-highest': '#2e3351',
        'surface-low': '#141936',
        'surface-lowest': '#070b28',
        'surface-bright': '#323756',
        'surface-variant': '#2e3351',

        // ---- On-surface (text) ----
        ink: '#dee0ff',
        'ink-muted': '#c2c6d7',
        'ink-dim': '#A0AEC0',

        // ---- Primary (light blue) ----
        primary: {
          DEFAULT: '#b0c6ff',
          container: '#558dff',
          fixed: '#d9e2ff',
          'fixed-dim': '#b0c6ff',
          on: '#002d6e',
          'on-container': '#002661',
          inverse: '#0058ca',
        },

        // ---- Secondary (lavender) ----
        secondary: {
          DEFAULT: '#bac3ff',
          container: '#2f3f92',
          on: '#15267b',
          'on-container': '#a3b0ff',
        },

        // ---- Tertiary / accent (emerald) ----
        accent: {
          DEFAULT: '#00e475',
          container: '#00a754',
          fixed: '#62ff96',
          on: '#003918',
          'on-container': '#003114',
        },

        // ---- Semantic ----
        success: '#00e475',
        warning: '#ffd700',
        danger: '#ffb4ab',
        'danger-container': '#93000a',
        'on-danger': '#690005',
        info: '#b0c6ff',

        // ---- Borders / outline ----
        outline: '#8c90a0',
        'outline-variant': '#424655',

        // ---- Overlays / glass ----
        glass: 'rgba(255, 255, 255, 0.05)',
        'glass-strong': 'rgba(255, 255, 255, 0.08)',
        overlay: 'rgba(7, 11, 40, 0.6)',

        // ---- White alpha ladder ----
        'overlay-white-3': 'rgba(255, 255, 255, 0.03)',
        'overlay-white-4': 'rgba(255, 255, 255, 0.04)',
        'overlay-white-5': 'rgba(255, 255, 255, 0.05)',
        'overlay-white-6': 'rgba(255, 255, 255, 0.06)',
        'overlay-white-7': 'rgba(255, 255, 255, 0.07)',
        'overlay-white-10': 'rgba(255, 255, 255, 0.10)',
        'overlay-white-12': 'rgba(255, 255, 255, 0.12)',
        'overlay-white-20': 'rgba(255, 255, 255, 0.20)',
        'overlay-white-30': 'rgba(255, 255, 255, 0.30)',
        'overlay-white-70': 'rgba(255, 255, 255, 0.70)',
        'overlay-white-75': 'rgba(255, 255, 255, 0.75)',
        'overlay-white-80': 'rgba(255, 255, 255, 0.80)',
        'overlay-blue-50': 'rgba(77, 163, 255, 0.50)',

        // ---- Hero gradient anchor tokens (used in style prop, mirrored here for className use) ----
        'gradient-start': '#1a3091',
        'gradient-mid': '#4d6dd1',
        'gradient-end': '#b0c6ff',
      },

      spacing: {
        xxs: '2px',
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        xxl: '24px',
        xxxl: '32px',
        huge: '40px',
        giant: '56px',
        mega: '72px',
      },

      borderRadius: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '20px',
        xxl: '24px',
        xxxl: '32px',
        pill: '9999px',
      },

      fontFamily: {
        display: ['Manrope-ExtraBold'],
        headline: ['Manrope-Bold'],
        'headline-semi': ['Manrope-SemiBold'],
        'headline-regular': ['Manrope-Regular'],
        body: ['Inter-Regular'],
        'body-medium': ['Inter-Medium'],
        'body-semibold': ['Inter-SemiBold'],
        'body-bold': ['Inter-Bold'],
      },

      fontSize: {
        xxs: ['10px', { lineHeight: '14px' }],
        xs: ['12px', { lineHeight: '17px' }],
        sm: ['13px', { lineHeight: '18px' }],
        md: ['14px', { lineHeight: '20px' }],
        lg: ['16px', { lineHeight: '23px' }],
        xl: ['18px', { lineHeight: '23px' }],
        xxl: ['20px', { lineHeight: '25px' }],
        xxxl: ['24px', { lineHeight: '30px' }],
        display: ['28px', { lineHeight: '31px' }],
        hero: ['32px', { lineHeight: '35px' }],
      },

      letterSpacing: {
        tighter: '-0.8px',
        tight: '-0.4px',
        wide: '0.3px',
        wider: '1px',
        widest: '2px',
      },

      boxShadow: {
        'glow-primary': '0 10px 20px rgba(176, 198, 255, 0.4)',
        'glow-accent': '0 0 16px rgba(0, 228, 117, 0.5)',
      },
    },
  },
  plugins: [],
};
