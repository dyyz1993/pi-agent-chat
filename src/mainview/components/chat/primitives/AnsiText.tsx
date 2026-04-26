import { useMemo } from "react";

const ESC = "\u001B";
const ANSI_REGEX = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

const COLOR_MAP: Record<string, string> = {
	"30": "text-gray-800",
	"31": "text-red-400",
	"32": "text-green-400",
	"33": "text-yellow-400",
	"34": "text-blue-400",
	"35": "text-purple-400",
	"36": "text-cyan-400",
	"37": "text-gray-200",
	"90": "text-gray-500",
	"91": "text-red-300",
	"92": "text-green-300",
	"93": "text-yellow-300",
	"94": "text-blue-300",
	"95": "text-purple-300",
	"96": "text-cyan-300",
	"97": "text-gray-100",
};

interface AnsiSpan {
	text: string;
	className: string;
}

export function parseAnsi(input: string): AnsiSpan[] {
	const spans: AnsiSpan[] = [];
	const parts = input.split(ANSI_REGEX);
	let currentClass = "text-gray-300";

	for (let i = 0; i < parts.length; i++) {
		if (i % 2 === 1) {
			const codes = parts[i]!.split(";");
			const reset = codes.includes("0") || parts[i] === "";
			if (reset) {
				currentClass = "text-gray-300";
			}
			for (const code of codes) {
				if (code === "1") {
					currentClass += " font-bold";
				} else if (COLOR_MAP[code]) {
					currentClass = COLOR_MAP[code]!;
				}
			}
		} else if (parts[i]) {
			spans.push({ text: parts[i]!, className: currentClass });
		}
	}

	return spans;
}

export function AnsiText({ content, className }: { content: string; className?: string }) {
	const spans = useMemo(() => parseAnsi(content), [content]);

	return (
		<pre className={`whitespace-pre-wrap font-mono ${className ?? ""}`}>
			{spans.map((span, i) => (
				<span key={i} className={span.className}>{span.text}</span>
			))}
		</pre>
	);
}
