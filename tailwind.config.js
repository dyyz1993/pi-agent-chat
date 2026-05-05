/** @type {import('tailwindcss').Config} */
export default {
	darkMode: "class",
	content: ["./src/mainview/**/*.{html,js,ts,jsx,tsx}"],
	theme: {
		extend: {
			colors: {
				gray: {
					850: "#1f2937",
					950: "#0a0c10",
				},
			},
			keyframes: {
				"slide-in-left": {
					from: { transform: "translateX(-100%)", opacity: "0" },
					to: { transform: "translateX(0)", opacity: "1" },
				},
				"slide-in-right": {
					from: { transform: "translateX(100%)", opacity: "0" },
					to: { transform: "translateX(0)", opacity: "1" },
				},
				"slide-in-up": {
					from: { transform: "translateY(100%)", opacity: "0" },
					to: { transform: "translateY(0)", opacity: "1" },
				},
			},
			animation: {
				"slide-in-left": "slide-in-left 200ms ease-out",
				"slide-in-right": "slide-in-right 200ms ease-out",
				"slide-in-up": "slide-in-up 250ms ease-out",
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};
