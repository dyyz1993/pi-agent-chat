/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/mainview/**/*.{html,js,ts,jsx,tsx}"],
	theme: {
		extend: {
			colors: {
				gray: {
					850: "#1f2937",
				},
			},
		},
	},
	plugins: [],
};
