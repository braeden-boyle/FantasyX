/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {},
  },
  plugins: [],
  // PrimeNG components style their own base elements (buttons, inputs, etc.) -
  // Tailwind's preflight reset would fight with that, so it's disabled here.
  corePlugins: {
    preflight: false,
  },
};
