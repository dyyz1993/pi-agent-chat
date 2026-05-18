/** @type {import('tailwindcss').Config} */
export default {
	darkMode: "class",
	content: ["./src/mainview/**/*.{html,js,ts,jsx,tsx}"],
	theme: {
		extend: {
			colors: {
				/* Design token colors — resolve to CSS vars that auto-adapt via theme */
				bg: {
					primary: "var(--color-bg-primary)",
					secondary: "var(--color-bg-secondary)",
					tertiary: "var(--color-bg-tertiary)",
					elevated: "var(--color-bg-elevated)",
					overlay: "var(--color-bg-overlay)",
				},
				text: {
					primary: "var(--color-text-primary)",
					secondary: "var(--color-text-secondary)",
					tertiary: "var(--color-text-tertiary)",
					inverse: "var(--color-text-inverse)",
				},
				border: {
					primary: "var(--color-border-primary)",
					secondary: "var(--color-border-secondary)",
					focus: "var(--color-border-focus)",
					accent: "var(--color-accent)",
				},
				accent: {
					default: "var(--color-accent)",
					hover: "var(--color-accent-hover)",
					muted: "var(--color-accent-muted)",
					text: "var(--color-accent-text)",
				},
				/* Semantic status colors (RGB format for opacity support) */
				status: {
					success: "rgb(var(--color-status-success) / <alpha-value>)",
					error: "rgb(var(--color-status-error) / <alpha-value>)",
					warning: "rgb(var(--color-status-warning) / <alpha-value>)",
					info: "rgb(var(--color-status-info) / <alpha-value>)",
				},
				/* Semantic category colors (RGB format for opacity support) */
				semantic: {
					agent: "rgb(var(--color-semantic-agent) / <alpha-value>)",
					tool: "rgb(var(--color-semantic-tool) / <alpha-value>)",
					memory: "rgb(var(--color-semantic-memory) / <alpha-value>)",
					accent: "rgb(var(--color-semantic-accent) / <alpha-value>)",
					notify: "rgb(var(--color-semantic-notify) / <alpha-value>)",
				},
				/* Surface colors (RGB format for opacity support) */
				surface: {
					code: "rgb(var(--surface-code) / <alpha-value>)",
					hover: "rgb(var(--surface-hover) / <alpha-value>)",
					dim: "rgb(var(--surface-dim) / <alpha-value>)",
				},
				/* Extended gray scale */
				gray: {
					850: "#1f2937",
					950: "#0a0c10",
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
