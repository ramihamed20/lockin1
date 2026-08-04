/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/LockInMode.jsx",
    "./src/components/lock-in/**/*.{js,jsx}"
  ],
  prefix: "li-",
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      fontFamily: {
        lockin: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      boxShadow: {
        "lock-panel": "0 20px 56px rgba(2, 7, 23, 0.28)"
      }
    }
  }
};
