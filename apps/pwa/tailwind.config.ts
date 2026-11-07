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
      },
    },
  },
  plugins: [],
};

export default config;
