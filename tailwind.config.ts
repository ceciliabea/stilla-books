import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FAF8F3",
        "paper-soft": "#F6F3ED",
        ink: "#2E2E2C",
        muted: "#8C867E",
        sage: "#A8B69A",
        gold: "#C8A96A",
      },
      fontFamily: {
        serif: ["Newsreader", "Georgia", "serif"],
        sans: ["Manrope", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
