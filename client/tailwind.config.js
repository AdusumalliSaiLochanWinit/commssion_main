/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e6edf5',
          100: '#c2d2e6',
          200: '#9ab4d4',
          300: '#7196c2',
          400: '#4a7cb4',
          500: '#2563a6',
          600: '#004b93',
          700: '#004083',
          800: '#003570',
          900: '#002755',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        lg: '0.625rem',
        md: '0.5rem',
        sm: '0.375rem',
      },
    },
  },
  plugins: [],
};