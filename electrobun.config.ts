import type { ElectrobunConfig } from "electrobun";

const desktopRenderer =
	(process.env.PI_ELECTROBUN_RENDERER?.toLowerCase() === "native" ? "native" : "cef") as
		| "native"
		| "cef";
const useCEFRenderer = desktopRenderer === "cef";

export default {
	app: {
		name: "PiAgentChat",
		identifier: "piagentchat.electrobun.dev",
		version: "1.0.0",
	},
	build: {
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		// Ignore Vite output in watch mode — HMR handles view rebuilds separately
		watchIgnore: ["dist/**"],
		mac: {
			bundleCEF: useCEFRenderer,
			defaultRenderer: desktopRenderer,
			entitlements: {
				"com.apple.security.device.microphone":
					"PiAgentChat uses microphone access for macOS dictation and voice input.",
				"com.apple.security.personal-information.speech-recognition":
					"PiAgentChat uses speech recognition access for macOS dictation and voice input.",
			},
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
