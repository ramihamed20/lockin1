import { useEffect, useRef, useState } from "react";
import { Languages, X } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { getSheetTranslation } from "../../api/sheetTranslation.js";
import "./sheet-translation.css";

export function SheetTranslationPanel({ documentId, page, onClose }) {
  const { t } = useI18n();
  const [result, setResult] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const closeRef = useRef(null);
  const key = `${documentId}/${page}`;
  const current = result?.key === key ? result : null;
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const dismiss = (event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", dismiss, true);
    return () => window.removeEventListener("keydown", dismiss, true);
  }, [onClose]);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setResult(null);
    getSheetTranslation(documentId, page, controller.signal)
      .then((data) => { if (active) setResult({ key, data }); })
      .catch(() => { if (active) setResult({ key, error: true }); });
    return () => { active = false; controller.abort(); };
  }, [documentId, key, page, refresh]);
  const state = current?.error ? "error" : current?.data?.status || "loading";
  return <div className="sheet-translation" tabIndex={-1} role="dialog" aria-modal="false" aria-labelledby="sheet-translation-title" onPointerDown={(event) => event.stopPropagation()}>
    <header><div><Languages size={20} aria-hidden="true" /><strong id="sheet-translation-title">{t("sheetTranslation.title")}</strong><small>{t("sheetTranslation.page", { page })}</small></div>
      <button ref={closeRef} type="button" aria-label={t("common.close")} onClick={onClose}><X size={20} /></button></header>
    <div className="sheet-translation__body" aria-busy={state === "loading"}>
      {state === "ready" ? <><p className="sheet-translation__notice">{t("sheetTranslation.notice")}</p>
        <div className="sheet-translation__text" lang="ar" dir="rtl">{current.data.translated_text}</div>
        {current.data.source_text && <details><summary>{t("sheetTranslation.original")}</summary><div className="sheet-translation__text" lang="en" dir="ltr">{current.data.source_text}</div></details>}
      </> : <div role="status"><p>{t(`sheetTranslation.${state}`)}</p>{["error", "unavailable"].includes(state) && <button type="button" onClick={() => setRefresh((value) => value + 1)}>{t("sheetTranslation.check")}</button>}</div>}
    </div>
  </div>;
}
