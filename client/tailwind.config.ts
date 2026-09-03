import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Read from CSS variables so a workspace's own colour applies at
        // runtime. The <alpha-value> placeholder keeps Tailwind's opacity
        // modifiers (bg-brand-600/50) working.
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
