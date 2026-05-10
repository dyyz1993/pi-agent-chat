import { GlobalWindow } from "happy-dom";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

const win = new GlobalWindow();

(globalThis as Record<string, unknown>).document = win.document;
(globalThis as Record<string, unknown>).window = win;
(globalThis as Record<string, unknown>).HTMLElement = win.HTMLElement;
(globalThis as Record<string, unknown>).HTMLInputElement = win.HTMLInputElement;
(globalThis as Record<string, unknown>).HTMLButtonElement = win.HTMLButtonElement;
(globalThis as Record<string, unknown>).HTMLSelectElement = win.HTMLSelectElement;
(globalThis as Record<string, unknown>).HTMLTextAreaElement = win.HTMLTextAreaElement;
(globalThis as Record<string, unknown>).SVGElement = win.SVGElement;
(globalThis as Record<string, unknown>).Text = win.Text;
(globalThis as Record<string, unknown>).Comment = win.Comment;
(globalThis as Record<string, unknown>).MutationObserver = win.MutationObserver;
(globalThis as Record<string, unknown>).IntersectionObserver = class {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};
(globalThis as Record<string, unknown>).ResizeObserver = class {
  constructor() {}
  observe() {}
  unobserve() {}
  disconnect() {}
};
(globalThis as Record<string, unknown>).matchMedia = () => ({
  matches: false,
  media: "",
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
});
(globalThis as Record<string, unknown>).getComputedStyle = () => ({});
(globalThis as Record<string, unknown>).navigator = {
  userAgent: "bun",
  clipboard: { writeText: () => Promise.resolve() },
};
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(cb, 0);
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => clearTimeout(id);

import { expect } from "bun:test";
expect.extend(jestDomMatchers);
