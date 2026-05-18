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
				status: {
					success: "rgb(var(--color-status-success) / <alpha-value>)",
					error: "rgb(var(--color-status-error) / <alpha-value>)",
					warning: "rgb(var(--color-status-warning) / <alpha-value>)",
					info: "rgb(var(--color-status-info) / <alpha-value>)",
				},
					surface: {
					code: "rgb(var(--surface-code) / <alpha-value>)",
					hover: "rgb(var(--surface-hover) / <alpha-value>)",
					dim: "rgb(var(--surface-dim) / <alpha-value>)",
				},
				semantic: {
					agent: "rgb(var(--color-semantic-agent) / <alpha-value>)",
					tool: "rgb(var(--color-semantic-tool) / <alpha-value>)",
					memory: "rgb(var(--color-semantic-memory) / <alpha-value>)",
					accent: "rgb(var(--color-semantic-accent) / <alpha-value>)",
					notify: "rgb(var(--color-semantic-notify) / <alpha-value>)",
				},
			},
			spacing: {
				"safe-top": "var(--safe-area-top)",
				"safe-bottom": "var(--safe-area-bottom)",
				"safe-left": "var(--safe-area-left)",
				"safe-right": "var(--safe-area-right)",
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
