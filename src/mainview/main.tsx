import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { apiClient } from "./lib/api-client";
import "./index.css";
import App from "./App";

const isElectrobun = typeof window !== "undefined" && !!window.__electrobunBunBridge;

if (isElectrobun) {
  apiClient.initSyncForDesktop();
}

document.addEventListener("touchstart", function(e) {
  const target = e.target as HTMLElement;
  let el: HTMLElement | null = target;
  while (el && el !== document.body) {
    if (el.offsetHeight < el.scrollHeight) {
      if (el.scrollTop === 0) {
        el.scrollTop = 1;
      } else if (el.scrollTop + el.offsetHeight === el.scrollHeight) {
        el.scrollTop = el.scrollHeight - el.offsetHeight - 1;
      }
      break;
    }
    el = el.parentElement;
  }
});

document.body.addEventListener("touchmove", (evt) => {
  const target = evt.target as HTMLElement;
  let el: HTMLElement | null = target;
  let isScroller = false;
  while (el && el !== document.body) {
    const hasVerticalScroll = el.offsetHeight < el.scrollHeight;
    const hasHorizontalScroll = el.offsetWidth < el.scrollWidth;
    if (hasVerticalScroll || hasHorizontalScroll) {
      isScroller = true;
      break;
    }
    el = el.parentElement;
  }
  if (!isScroller) {
    evt.preventDefault();
  }
}, { passive: false });

// eslint-disable-next-line no-console
console.log("[Main] Application starting, isElectrobun:", isElectrobun);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
