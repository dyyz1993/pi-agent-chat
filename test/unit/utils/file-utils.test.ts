import { describe, it, expect } from "vitest";
import { getLanguage, isTextFile, isImageFile, formatSize } from "../../../src/mainview/utils/file-utils";

describe("getLanguage", () => {
  it("maps common extensions", () => {
    expect(getLanguage("app.ts")).toBe("typescript");
    expect(getLanguage("App.tsx")).toBe("tsx");
    expect(getLanguage("index.js")).toBe("javascript");
    expect(getLanguage("Button.jsx")).toBe("jsx");
    expect(getLanguage("main.py")).toBe("python");
    expect(getLanguage("main.rs")).toBe("rust");
    expect(getLanguage("main.go")).toBe("go");
  });

  it("returns empty string for unknown extensions", () => {
    expect(getLanguage("file.xyz")).toBe("");
    expect(getLanguage("file.abc123")).toBe("");
  });

  it("handles filenames with no extension", () => {
    expect(getLanguage("README")).toBe("");
    expect(getLanguage("Makefile")).toBe("");
  });

  it("is case insensitive", () => {
    expect(getLanguage("app.TS")).toBe("typescript");
    expect(getLanguage("app.Tsx")).toBe("tsx");
    expect(getLanguage("app.JS")).toBe("javascript");
  });

  it("maps mjs/cjs/mts/cts variants", () => {
    expect(getLanguage("config.mjs")).toBe("javascript");
    expect(getLanguage("config.cjs")).toBe("javascript");
    expect(getLanguage("app.mts")).toBe("typescript");
    expect(getLanguage("app.cts")).toBe("typescript");
  });

  it("maps shell scripts to bash syntax highlighting", () => {
    expect(getLanguage("guard-write.sh")).toBe("bash");
    expect(getLanguage("deploy.bash")).toBe("bash");
  });
});

describe("isTextFile", () => {
  it("returns true for common text extensions", () => {
    expect(isTextFile("app.ts")).toBe(true);
    expect(isTextFile("data.json")).toBe(true);
    expect(isTextFile("README.md")).toBe(true);
    expect(isTextFile("config.yml")).toBe(true);
  });

  it("returns false for binary extensions", () => {
    expect(isTextFile("image.png")).toBe(false);
    expect(isTextFile("program.exe")).toBe(false);
    expect(isTextFile("archive.zip")).toBe(false);
  });

  it("is case insensitive", () => {
    expect(isTextFile("APP.TS")).toBe(true);
    expect(isTextFile("Data.JSON")).toBe(true);
  });

  it("recognizes dotfiles via extension extraction", () => {
    expect(isTextFile(".env")).toBe(true);
    expect(isTextFile(".gitignore")).toBe(true);
  });
});

describe("isImageFile", () => {
  it("returns true for common image extensions", () => {
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("photo.jpeg")).toBe(true);
    expect(isImageFile("photo.gif")).toBe(true);
    expect(isImageFile("icon.svg")).toBe(true);
    expect(isImageFile("photo.webp")).toBe(true);
    expect(isImageFile("favicon.ico")).toBe(true);
    expect(isImageFile("photo.bmp")).toBe(true);
  });

  it("returns false for non-image files", () => {
    expect(isImageFile("app.ts")).toBe(false);
    expect(isImageFile("doc.pdf")).toBe(false);
    expect(isImageFile("data.json")).toBe(false);
  });
});

describe("formatSize", () => {
  it("formats bytes < 1024", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("formats KB range", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(512000)).toBe("500.0 KB");
  });

  it("formats MB range", () => {
    expect(formatSize(1048576)).toBe("1.0 MB");
    expect(formatSize(2097152)).toBe("2.0 MB");
  });

  it("handles exact 1024 bytes", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
  });
});
