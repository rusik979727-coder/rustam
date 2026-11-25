import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#eef7f6", 100: "#d5ece9", 500: "#1f8a80", 600: "#16736a", 700: "#115a53", 900: "#0b3a36" },
      },
    },
  },
  plugins: [],
} satisfies Config;
