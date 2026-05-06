import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import zhCommon from "../locales/zh-CN/common.json";
import zhChat from "../locales/zh-CN/chat.json";
import zhSidebar from "../locales/zh-CN/sidebar.json";
import zhStatus from "../locales/zh-CN/status.json";
import zhGit from "../locales/zh-CN/git.json";
import zhExplorer from "../locales/zh-CN/explorer.json";
import zhMemory from "../locales/zh-CN/memory.json";
import zhSnapshot from "../locales/zh-CN/snapshot.json";
import zhRules from "../locales/zh-CN/rules.json";
import zhDebug from "../locales/zh-CN/debug.json";
import zhTheme from "../locales/zh-CN/theme.json";
import zhSettings from "../locales/zh-CN/settings.json";

import enCommon from "../locales/en/common.json";
import enChat from "../locales/en/chat.json";
import enSidebar from "../locales/en/sidebar.json";
import enStatus from "../locales/en/status.json";
import enGit from "../locales/en/git.json";
import enExplorer from "../locales/en/explorer.json";
import enMemory from "../locales/en/memory.json";
import enSnapshot from "../locales/en/snapshot.json";
import enRules from "../locales/en/rules.json";
import enDebug from "../locales/en/debug.json";
import enSettings from "../locales/en/settings.json";
import enTheme from "../locales/en/theme.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "zh-CN": {
        common: zhCommon,
        chat: zhChat,
        sidebar: zhSidebar,
        status: zhStatus,
        git: zhGit,
        explorer: zhExplorer,
        memory: zhMemory,
        snapshot: zhSnapshot,
        rules: zhRules,
        debug: zhDebug,
        theme: zhTheme,
        settings: zhSettings,
      },
      en: {
        common: enCommon,
        chat: enChat,
        sidebar: enSidebar,
        status: enStatus,
        git: enGit,
        explorer: enExplorer,
        memory: enMemory,
        snapshot: enSnapshot,
        rules: enRules,
        debug: enDebug,
        theme: enTheme,
        settings: enSettings,
      },
    },
    fallbackLng: "zh-CN",
    defaultNS: "common",
    ns: [
      "common",
      "chat",
      "sidebar",
      "status",
      "git",
      "explorer",
      "memory",
      "snapshot",
      "rules",
      "debug",
      "theme",
      "settings",
    ],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "pi-language",
      caches: ["localStorage"],
    },
  });

export default i18n;
