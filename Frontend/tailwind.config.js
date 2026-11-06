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
          primary: '#8BB964',
          hover: '#7aa854',
          dark: '#689244',
          light: '#f2f8ed',
        }
      }
    },
  },
  plugins: [],
}
