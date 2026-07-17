import { useI18n } from "../../../i18n/I18nProvider";

export type SaveState = "idle" | "saving" | "saved" | "failed";

export function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const { t } = useI18n();
  if (state === "idle") return <span className="save-indicator">{t("notAnswered")}</span>;
  if (state === "failed") {
    return (
      <span className="save-indicator save-indicator--failed" role="alert">
        {t("answerNotSaved")}
        <button type="button" onClick={onRetry}>{t("retry")}</button>
      </span>
    );
  }
  return (
    <span className="save-indicator" role="status" aria-live="polite">
      {state === "saving" ? t("savingAnswer") : t("answerSaved")}
    </span>
  );
}
