/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        palette: {
          cream: '#FFF5F5',
          peach: '#F7D7D1',
          rose: '#E3B5BE',
          charcoal: '#484949',
        },
        background: '#18191B',
        backgroundDark: '#121314',
        surface: '#222326',
        surfaceElevated: '#2A2C2F',
        surfaceBorder: '#393B3F',
        surfaceBorderWarm: 'rgba(247, 215, 209, 0.16)',
        accent: '#E3B5BE',
        accentHover: '#D49FA9',
        accentWarm: '#F7D7D1',
        brandYellow: '#F7D7D1',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

