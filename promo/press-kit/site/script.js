/* global document, IntersectionObserver */
const menuToggle = document.querySelector(".menu-toggle");
const siteNav = document.querySelector(".site-nav");

menuToggle?.addEventListener("click", () => {
  const isOpen = siteNav.classList.toggle("is-open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

siteNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    siteNav.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
  });
});

const demoVideo = document.querySelector("#demo-video");
const demoSource = document.querySelector("#demo-source");
const deviceLabel = document.querySelector("#device-label");
const deviceButtons = document.querySelectorAll("[data-device]");
const videoSources = {
  desktop: "assets/desktop-ui-hero-preview.mp4",
  mobile: "assets/mobile-ui-panel-preview.mp4",
};

deviceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const device = button.dataset.device;
    if (!videoSources[device] || !demoVideo || !demoSource) return;
    const wasPlaying = !demoVideo.paused;
    demoVideo.pause();
    demoSource.src = videoSources[device];
    demoVideo.load();
    if (wasPlaying) demoVideo.play().catch(() => {});
    deviceLabel.textContent = device === "mobile" ? "Mobile · 390 × 844" : "Desktop · 1440 × 900";
    deviceButtons.forEach((item) => {
      const isActive = item === button;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
    });
  });
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);

document.querySelectorAll(".reveal").forEach((element) => revealObserver.observe(element));
