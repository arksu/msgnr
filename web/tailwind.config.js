/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Slack-inspired dark palette
        sidebar: {
          bg: '#19171D',
          hover: '#27242C',
          active: '#1164A3',
          text: '#a59ca5',
          unreadBage: '#ffbebe',
          textMuted: '#9B8D9B',
          heading: '#7B6C7B',
        },
        chat: {
          bg: '#1A1D21',
          header: '#1A1D21',
          input: '#222529',
          border: '#2E3239',
          msgHover: '#1E2126',
        },
        accent: {
          DEFAULT: '#1164A3',
          hover: '#0E538C',
        },
      },
    },
  },
  plugins: [],
}
