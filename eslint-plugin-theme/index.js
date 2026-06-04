/**
 * eslint-plugin-theme — 主题/颜色约束 ESLint 插件
 *
 * 规则列表：
 *   - theme/color-pairing : 语义颜色必须配对亮色/暗色变体，禁止裸用暗色优化色阶
 */
"use strict";

const colorPairing = require("./rules/theme-color-pairing");

module.exports = {
  meta: {
    name: "eslint-plugin-theme",
    version: "1.0.0",
  },
  rules: {
    "color-pairing": colorPairing,
  },
  configs: {
    recommended: {
      plugins: ["theme"],
      rules: {
        "theme/color-pairing": "error",
      },
    },
  },
};
