/**
 * Haptic Feedback 触觉反馈
 * 
 * Web: 使用 Vibration API（navigator.vibrate）
 * Native: 通过 Platform Bridge 使用 Capacitor Haptics
 */
import { isNative } from './platform/index';

export const haptic = {
  /** 轻触反馈 — 按钮点击 */
  light(): void {
    if (isNative()) {
      import('@capacitor/haptics').then(({ Haptics, HapticsNotificationType }) => {
        Haptics.notification({ type: HapticsNotificationType.Light });
      }).catch(() => {});
    } else if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  },

  /** 中等反馈 — 消息发送成功 */
  medium(): void {
    if (isNative()) {
      import('@capacitor/haptics').then(({ Haptics, HapticsNotificationType }) => {
        Haptics.notification({ type: HapticsNotificationType.Warning });
      }).catch(() => {});
    } else if (navigator.vibrate) {
      navigator.vibrate(25);
    }
  },

  /** 重度反馈 — 错误 */
  heavy(): void {
    if (isNative()) {
      import('@capacitor/haptics').then(({ Haptics, HapticsNotificationType }) => {
        Haptics.notification({ type: HapticsNotificationType.Error });
      }).catch(() => {});
    } else if (navigator.vibrate) {
      navigator.vibrate([50, 30, 50]);
    }
  },

  /** 选中反馈 — Tab 切换 */
  selection(): void {
    if (isNative()) {
      import('@capacitor/haptics').then(({ Haptics }) => {
        Haptics.selectionStart();
        Haptics.selectionChanged();
        Haptics.selectionEnd();
      }).catch(() => {});
    } else if (navigator.vibrate) {
      navigator.vibrate(5);
    }
  },
};
