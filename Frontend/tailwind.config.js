/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        poppins: ['Poppins', 'sans-serif'],
      },
      colors: {
        brand: {
          primary: '#527A36',
          hover: '#466B2D',
          dark: '#3F6526',
          accent: '#8BB964',
          light: '#f2f8ed',
        }
      }
    },
  },
  plugins: [],
}
