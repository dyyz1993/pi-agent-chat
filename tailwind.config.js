const tokenColor = (token) => {
  return ({ opacityValue }) => {
    if (opacityValue === undefined) return `var(${token})`;
    return `color-mix(in srgb, var(${token}) calc(${opacityValue} * 100%), transparent)`;
  };
};

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./src/mainview/**/*.{html,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Design token colors — resolve to CSS vars that auto-adapt via theme */
        bg: {
          primary: tokenColor("--color-bg-primary"),
          secondary: tokenColor("--color-bg-secondary"),
          tertiary: tokenColor("--color-bg-tertiary"),
          elevated: tokenColor("--color-bg-elevated"),
          overlay: "var(--color-bg-overlay)",
        },
        text: {
          primary: tokenColor("--color-text-primary"),
          secondary: tokenColor("--color-text-secondary"),
          tertiary: tokenColor("--color-text-tertiary"),
          inverse: tokenColor("--color-text-inverse"),
        },
        border: {
          primary: tokenColor("--color-border-primary"),
          secondary: tokenColor("--color-border-secondary"),
          focus: tokenColor("--color-border-focus"),
          accent: tokenColor("--color-accent"),
        },
        accent: {
          DEFAULT: tokenColor("--color-accent"),
          hover: tokenColor("--color-accent-hover"),
          muted: "var(--color-accent-muted)",
          text: tokenColor("--color-accent-text"),
          brand: tokenColor("--color-accent-brand"),
          idle: tokenColor("--color-accent-idle"),
          agent: tokenColor("--color-accent-agent"),
        },
        /* Runtime/connection type colors (fixed, theme-independent) */
        runtime: {
          ssh: "rgb(var(--runtime-ssh) / <alpha-value>)",
          sandbox: "rgb(var(--runtime-sandbox) / <alpha-value>)",
          docker: "rgb(var(--runtime-docker) / <alpha-value>)",
          local: "rgb(var(--runtime-local) / <alpha-value>)",
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
          line: tokenColor("--color-semantic-line"),
        },
        /* Surface colors */
        surface: {
          code: tokenColor("--surface-code"),
          hover: tokenColor("--surface-hover"),
          dim: tokenColor("--surface-dim"),
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
        indent: "var(--spacing-indent-base)",
      },
      fontSize: {
        input: "var(--input-font-size)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      boxShadow: {
        subtle: "var(--shadow-subtle)",
        floating: "var(--shadow-floating)",
      },
      zIndex: {
        float: "var(--z-float)",
        header: "var(--z-header)",
        drawer: "var(--z-drawer)",
        overlay: "var(--z-overlay)",
        dropdown: "var(--z-dropdown)",
        modal: "var(--z-modal)",
        popover: "var(--z-popover)",
        toast: "var(--z-toast)",
        tooltip: "var(--z-tooltip)",
        fullscreen: "var(--z-fullscreen)",
        system: "var(--z-system)",
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
