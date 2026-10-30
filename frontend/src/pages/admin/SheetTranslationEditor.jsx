import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { sheetTranslationAdminApi } from "../../api/sheetTranslation.js";
import { MAX_TRANSLATION_FILE_BYTES, MAX_TRANSLATION_TEXT, parseTranslationImport, translationTemplate, translationWriteBody } from "../../lib/sheetTranslationImport.js";
import { triggerDownload } from "../../workspace/catalog/exportDelivery.js";
import "./sheet-translation-editor.css";

export function SheetTranslationEditor({ sheetId, edition }) {
  const { t } = useI18n();
  const [source, setSource] = useState(null), [attempt, setAttempt] = useState(0), [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState({}), [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const templateUrlRef = useRef("");
  useEffect(() => () => { if (templateUrlRef.current) URL.revokeObjectURL(templateUrlRef.current); }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError("");
    sheetTranslationAdminApi.load(sheetId, edition, controller.signal)
      .then((data) => { if (active) setSource(data); })
      .catch((failure) => { if (active) setError(failure.message || t("sheetTranslationAdmin.loadFailed")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
    // Language changes must not replace unsaved admin text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetId, edition, attempt]);
  const rows = source?.pages || [];
  const current = rows.find((row) => row.page === page);
  const text = Object.hasOwn(drafts, page) ? drafts[page] : current?.text || "";
  const dirty = Object.keys(drafts).length;
  const fail = (failure) => setError(failure?.message?.startsWith("sheetTranslationAdmin.") ? t(failure.message) : failure?.message || t("sheetTranslationAdmin.saveFailed"));
  async function save(pages) {
    if (!source || busy) return;
    setBusy(true); setError(""); setMessage("");
    try { const data = await sheetTranslationAdminApi.save(sheetId, edition, translationWriteBody(source, pages));
      setSource(data); setDrafts({}); setPreview(null); setMessage(t("sheetTranslationAdmin.saved", { count: pages.length }));
    } catch (failure) { fail(failure); } finally { setBusy(false); }
  }
  async function chooseFile(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !source) return;
    setError(""); setMessage(""); setPreview(null); setBusy(true);
    try { if (file.size > MAX_TRANSLATION_FILE_BYTES) throw new Error("sheetTranslationAdmin.tooLarge");
      setPreview({ name: file.name, pages: parseTranslationImport(await file.text(), source) });
    } catch (failure) { fail(failure); } finally { setBusy(false); }
  }
  function downloadTemplate() {
    if (templateUrlRef.current) URL.revokeObjectURL(templateUrlRef.current);
    templateUrlRef.current = URL.createObjectURL(new Blob([JSON.stringify(translationTemplate(source), null, 2)], { type: "application/json;charset=utf-8" }));
    triggerDownload(templateUrlRef.current, `translation-${edition}.json`);
  }
  if (loading) return <p role="status">{t("common.loading")}</p>;
  if (!source) return <div role="alert"><p>{error}</p><button className="btn btn-soft" type="button" onClick={() => setAttempt((value) => value + 1)}>{t("common.tryAgain")}</button></div>;
  return <section className="translation-editor" aria-label={t("sheetTranslation.title")}>
    <header><h3>{t("sheetTranslation.title")}</h3><p>{t("sheetTranslationAdmin.intro")}</p><strong>{t("sheetTranslationAdmin.progress", { done: source.translated_pages, total: source.page_count })}</strong></header>
    {error && <p className="form-alert error" role="alert">{error}</p>}{message && <p className="form-alert success" role="status">{message}</p>}
    <div className="translation-editor__navigation">
      <button type="button" className="btn btn-soft compact" disabled={busy || page === 1} onClick={() => setPage((value) => value - 1)}>{t("sheetTranslationAdmin.previous")}</button>
      <label>{t("sheetTranslationAdmin.page")}<select value={page} disabled={busy} onChange={(event) => setPage(Number(event.target.value))}>{Array.from({ length: source.page_count }, (_, index) => index + 1).map((number) => <option key={number} value={number}>{number}{rows.some((row) => row.page === number && row.text.trim()) ? " ✓" : ""}</option>)}</select></label>
      <button type="button" className="btn btn-soft compact" disabled={busy || page === source.page_count} onClick={() => setPage((value) => value + 1)}>{t("sheetTranslationAdmin.next")}</button>
    </div>
    <label>{t("sheetTranslationAdmin.fullPage", { page })}<textarea rows={15} lang="ar" dir="rtl" value={text} maxLength={MAX_TRANSLATION_TEXT} disabled={busy} placeholder={t("sheetTranslationAdmin.placeholder")} onChange={(event) => {
      const value = event.target.value; setDrafts((previous) => { const next = { ...previous }; if (value === (current?.text || "")) delete next[page]; else next[page] = value; return next; });
    }} /></label><p className="translation-editor__hint">{t("sheetTranslationAdmin.clearHint")}</p>
    <div className="translation-editor__actions">
      <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={() => void save(Object.entries(drafts).map(([number, value]) => ({ page: Number(number), text: value, source_text: rows.find((row) => row.page === Number(number))?.source_text || "" })))}>{busy ? t("sheetTranslationAdmin.saving") : t("sheetTranslationAdmin.saveDrafts", { count: dirty })}</button>
      {dirty > 0 && <button type="button" className="btn btn-soft" disabled={busy} onClick={() => setDrafts({})}>{t("sheetTranslationAdmin.discard")}</button>}
      <button type="button" className="btn btn-soft" disabled={busy || Boolean(dirty)} onClick={() => { setPreview(null); setAttempt((value) => value + 1); }}>{t("sheetTranslationAdmin.reload")}</button>
    </div>
    <div className="translation-editor__import"><h4>{t("sheetTranslationAdmin.importTitle")}</h4><p>{t("sheetTranslationAdmin.importHint")}</p>
      <div className="translation-editor__actions"><button className="btn btn-soft" type="button" disabled={busy} onClick={downloadTemplate}>{t("sheetTranslationAdmin.template")}</button>
        <label className="btn btn-soft admin-file-button">{t("sheetTranslationAdmin.chooseFile")}<input aria-label={t("sheetTranslationAdmin.chooseFile")} type="file" accept="application/json,.json" disabled={busy || Boolean(dirty)} onChange={chooseFile} /></label>
      </div>{Boolean(dirty) && <p>{t("sheetTranslationAdmin.saveBeforeImport")}</p>}
      {preview && <div className="translation-editor__preview"><strong>{preview.name}</strong><p>{t("sheetTranslationAdmin.preview", { count: preview.pages.length })}</p><ul>{preview.pages.slice(0, 8).map((item) => <li key={item.page}><strong>{t("sheetTranslation.page", { page: item.page })}</strong><p lang="ar" dir="rtl">{item.text.slice(0, 180)}{item.text.length > 180 ? "…" : ""}</p></li>)}</ul>
        <button className="btn btn-primary" type="button" disabled={busy || Boolean(dirty)} onClick={() => void save(preview.pages)}>{t("sheetTranslationAdmin.confirmImport", { count: preview.pages.length })}</button>
        <button className="btn btn-soft" type="button" disabled={busy} onClick={() => setPreview(null)}>{t("sheetTranslationAdmin.cancelImport")}</button>
      </div>}
    </div>
  </section>;
}
