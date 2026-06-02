import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNotificationStore } from "../../stores/use-notification-store";
import { copyToClipboard } from "../../utils/clipboard";

export interface CopyFeedbackOptions {
  successMessage?: string;
  failureMessage?: string;
  showToast?: boolean;
}

export function useCopyFeedback(defaultOptions: CopyFeedbackOptions = {}) {
  const { t } = useTranslation("common");
  const pushNotification = useNotificationStore((s) => s.push);
  const {
    successMessage: defaultSuccessMessage,
    failureMessage: defaultFailureMessage,
    showToast: defaultShowToast,
  } = defaultOptions;

  return useCallback(
    async (text: string, options: CopyFeedbackOptions = {}) => {
      const successMessage = options.successMessage ?? defaultSuccessMessage;
      const failureMessage = options.failureMessage ?? defaultFailureMessage;
      const showToast = options.showToast ?? defaultShowToast;
      const ok = await copyToClipboard(text);
      if (showToast !== false) {
        pushNotification({
          level: ok ? "info" : "error",
          message: ok
            ? (successMessage ?? t("copiedToClipboard"))
            : (failureMessage ?? t("copyFailed")),
        });
      }
      return ok;
    },
    [defaultFailureMessage, defaultShowToast, defaultSuccessMessage, pushNotification, t],
  );
}
