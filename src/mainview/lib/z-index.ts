/**
 * Z-Index 层级管理
 *
 * 层级规则：数值越大越靠前。同层级内按 DOM 顺序排列。
 * 新增浮层请在此文件中添加常量，禁止在组件中硬编码 z-index 值。
 */
export const Z_INDEX = {
  BASE: 10,
  MESSAGE_BUBBLE: 10,
  MAIN_LAYOUT: 10,
  MESSAGE_CARD: 20,
  SIDEBAR: 20,
  PANEL: 40,
  OVERLAY: 50,
  SPECIAL_PANEL: 60,
  DIALOG: 100,
  FULLSCREEN: 200,
} as const;
