/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0F1E2E",
        ledger: "#1F7A5C",
        paper: "#F7F5F0",
        ink: "#1A1A1A",
        slate: "#5B6B7A",
        alert: "#B3413A",
      },
    },
  },
  plugins: [],
};
