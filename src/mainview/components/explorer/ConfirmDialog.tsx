import { useTranslation } from "react-i18next";
import { Button, ModalDialog } from "../primitives";

interface ConfirmDialogProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation("common");

  return (
    <ModalDialog
      title={title}
      onClose={onCancel}
      closeLabel={t("cancel")}
      size="sm"
      showCloseButton={false}
      bodyClassName="px-4 py-4"
      footer={
        <>
          <Button size="md" variant="secondary" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button size="md" variant="danger" onClick={onConfirm}>
            {t("delete")}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">{message}</p>
    </ModalDialog>
  );
}
