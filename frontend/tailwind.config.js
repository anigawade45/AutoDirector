/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0B0F17',
        surface: '#151D2A',
        surfaceBorder: '#233044',
        accent: '#3B82F6',
        accentHover: '#2563EB',
        brandYellow: '#FFD84D',
      },
    },
  },
  plugins: [],
};

