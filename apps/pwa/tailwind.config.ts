import type { Config } from 'tailwindcss';

/**
 * theme_color do manifest.ts / layout.tsx (#1A3A5C) é a fonte da cor primary.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef3f8',
          100: '#d3e0ec',
          200: '#a7c1d9',
          300: '#7aa2c6',
          400: '#4e83b3',
          500: '#2f6795',
          600: '#245073',
          700: '#1a3a5c',
          800: '#152e49',
          900: '#0f2236',
        },
        brand: {
          dark: '#512B1E',
          light: '#F7E6D6',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          alt: '#FAF6F2',
        },
        'text-primary': '#1A0E09',
        'text-muted': '#7A5C52',
        border: '#E8D5C4',
        success: '#3D7A4F',
        danger: '#C0392B',
        warning: '#D4860B',
      },
      fontFamily: {
        brand: ['Jollin Italic', 'serif'],
        ui: ['Helvetica Neue LT Com', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        sm: '6px',
        md: '12px',
        lg: '20px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(81,43,30,0.08)',
        modal: '0 8px 32px rgba(81,43,30,0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
