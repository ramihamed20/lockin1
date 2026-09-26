import { useI18n } from "../I18nProvider.jsx";
import { ConfirmDialog } from "./ConfirmDialog.jsx";
import "./question-flow.css";

/**
 * The one way out of an unfinished checkpoint or exam: keep the answers and
 * resume later, throw this attempt away, or stay. Completed parts are never at
 * stake in either exit, and the copy says so.
 */
export function CheckpointExitDialog({ open, busy = false, onSave, onDiscard, onCancel }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      open={open}
      busy={busy}
      title={t("checkpoint.exitTitle")}
      message={t("checkpoint.exitMessage")}
      confirmLabel={t("checkpoint.exitSave")}
      confirmVariant="primary"
      secondaryLabel={t("checkpoint.exitDiscard")}
      onSecondary={onDiscard}
      onConfirm={onSave}
      onCancel={onCancel}
    />
  );
}

/** Confirmation before a checkpoint attempt is cleared and started again. */
export function CheckpointRestartDialog({ open, busy = false, onConfirm, onCancel }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog
      open={open}
      busy={busy}
      title={t("checkpoint.restartTitle")}
      message={t("checkpoint.restartMessage")}
      confirmLabel={t("checkpoint.restart")}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
