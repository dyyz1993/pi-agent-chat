import { describe, it, expect, beforeAll } from "vitest";
import "../../../src/mainview/lib/i18n";
import i18n from "i18next";

describe("i18n", () => {
  beforeAll(async () => {
    await i18n.init();
  });

  it("should have zh-CN as fallback language", () => {
    expect(i18n.options.fallbackLng).toEqual(["zh-CN"]);
  });

  it("should translate common keys in Chinese", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("common:confirm")).toBe("确认");
    expect(i18n.t("common:cancel")).toBe("取消");
  });

  it("should translate common keys in English", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("common:confirm")).toBe("Confirm");
    expect(i18n.t("common:cancel")).toBe("Cancel");
  });

  it("should support interpolation", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("common:minutesAgo", { count: 5 })).toBe("5 分钟前");
  });

  it("should support English interpolation", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("common:minutesAgo", { count: 5 })).toBe("5m ago");
  });

  it("should translate chat keys", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(i18n.t("chat:send")).toBe("发送");
  });

  it("should translate status keys", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("status:thinkingHigh")).toBe("High");
  });

  it("should list all configured namespaces", () => {
    const ns = i18n.options.ns as string[];
    expect(ns).toContain("common");
    expect(ns).toContain("chat");
    expect(ns).toContain("sidebar");
    expect(ns).toContain("status");
    expect(ns).toContain("git");
    expect(ns).toContain("explorer");
    expect(ns).toContain("memory");
    expect(ns).toContain("snapshot");
    expect(ns).toContain("rules");
    expect(ns).toContain("debug");
    expect(ns).toContain("theme");
  });
});
