import { describe, it, expect } from "vitest";
import enChat from "../src/mainview/locales/en/chat.json";
import zhChat from "../src/mainview/locales/zh-CN/chat.json";

const ROLLBACK_I18N_KEYS = [
  "rollbackOverlay.title",
  "rollbackOverlay.titleWithFiles",
  "rollbackOverlay.messageModeDesc",
  "rollbackOverlay.withFilesModeDesc",
  "rollbackOverlay.confirm",
  "rollbackOverlay.cancel",
  "rollbackOverlay.noFiles",
  "rollbackOverlay.fileWillBeDeleted",
  "rollbackOverlay.fileWillBeRemoved",
  "rollbackOverlay.fileWillBeRestored",
  "rollbackOverlay.rollbackCancelled",
  "rollbackOverlay.rollbackIneffective",
  "rollbackOverlay.rollbackFailed",
  "rollbackOverlay.fileCount",
  "rollbackOverlay.fileCreatedLabel",
  "rollbackOverlay.beforeLabel",
  "rollbackOverlay.afterLabel",
  "rollbackOverlay.truncated",
];

describe("rollback i18n keys", () => {
  it("has all rollback keys in en/chat.json", () => {
    for (const key of ROLLBACK_I18N_KEYS) {
      expect(enChat[key as keyof typeof enChat], `Missing en key: ${key}`).toBeDefined();
    }
  });

  it("has all rollback keys in zh-CN/chat.json", () => {
    for (const key of ROLLBACK_I18N_KEYS) {
      expect(zhChat[key as keyof typeof zhChat], `Missing zh-CN key: ${key}`).toBeDefined();
    }
  });

  it("en and zh-CN have the same rollback key set", () => {
    const enKeys = ROLLBACK_I18N_KEYS.filter((k) => k in enChat);
    const zhKeys = ROLLBACK_I18N_KEYS.filter((k) => k in zhChat);
    expect(enKeys).toEqual(zhKeys);
  });

  it("no rollback key has empty value in en", () => {
    for (const key of ROLLBACK_I18N_KEYS) {
      const val = enChat[key as keyof typeof enChat];
      expect(val, `Empty en value for key: ${key}`).not.toBe("");
    }
  });

  it("no rollback key has empty value in zh-CN", () => {
    for (const key of ROLLBACK_I18N_KEYS) {
      const val = zhChat[key as keyof typeof zhChat];
      expect(val, `Empty zh-CN value for key: ${key}`).not.toBe("");
    }
  });
});
