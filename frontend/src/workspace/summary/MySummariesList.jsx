import "./summary.css";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, ExternalLink, Keyboard, PenLine } from "lucide-react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { EmptyState, ErrorPanel, LoadingPanel } from "../../components/ui/index.jsx";
import { sheetSummariesApi } from "../../api/sheetSummaries.js";
import { catalogWorkspaceApi } from "../../api/catalogWorkspace.js";
import { createExportHandle, triggerDownload } from "../catalog/exportDelivery.js";
import { buildSummaryPdf, SUMMARY_COLORS, writtenTextPages } from "./summaryPdf.js";

/** Ink on a pen summary's pages, read from the sheet's saved workspace. */
async function penPagesFor(summary) {
  const workspace = /** @type {any} */ (await catalogWorkspaceApi.get(summary.document.id));
  const pages = (workspace?.state?.virtual_pages || []).filter((item) => item?.summary === summary.id);
  const marks = workspace?.state?.virtual_annotations || [];
  return pages.sort((a, b) => a.afterPage - b.afterPage).map((item) => ({
    pdfPage: item.afterPage,
    background: item.background || "blank",
    annotations: marks.filter((mark) => mark.page === item.id)
  }));
}

function SummaryRow({ summary }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ModeIcon = summary.mode === "pen" ? PenLine : Keyboard;
  const date = new Date(summary.finished_at || summary.updated_at).toLocaleDateString(document.documentElement.lang || undefined);
  const written = summary.mode === "keyboard" ? writtenTextPages(summary).length : null;
  async function download() {
    setBusy(true);
    setError("");
    try {
      const penPages = summary.mode === "pen" ? await penPagesFor(summary) : [];
      const count = summary.mode === "pen" ? penPages.filter((item) => item.annotations.length).length : written;
      const blob = await buildSummaryPdf({
        summary,
        sheetTitle: summary.document.title,
        penPages,
        labels: {
          kicker: t("summary.pdfKicker"),
          details: t("summary.pdfDetails", { mode: t(summary.mode === "pen" ? "summary.pen" : "summary.keyboard"), count, date }),
          page: (number) => t("summary.pdfPage", { page: number })
        }
      });
      const name = `${summary.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "summary"}.pdf`;
      const handle = createExportHandle(blob, name);
      triggerDownload(handle.url, name);
      window.setTimeout(() => handle.revoke(), 60_000);
    } catch (failure) {
      setError(/** @type {any} */ (failure)?.message || t("summary.loadFailed"));
    } finally {
      setBusy(false);
    }
  }
  const to = `/materials/catalog/${encodeURIComponent(summary.document.material_slug)}/sheets/${encodeURIComponent(summary.document.sheet_slug)}/workspace`;
  return <li className="summary-row" style={/** @type {any} */ ({ "--summary-accent": SUMMARY_COLORS[summary.color]?.accent })}>
    <span className="summary-card__icon"><ModeIcon size={18} aria-hidden="true" /></span>
    <div className="summary-row__text">
      <strong dir="auto">{summary.title}</strong>
      <small dir="auto">{summary.document.material_title} · {summary.document.title}</small>
      <small>{t(summary.mode === "pen" ? "summary.pen" : "summary.keyboard")} · {t(summary.status === "finished" ? "summary.finished" : "summary.writing")} · {date}</small>
      {error && <small className="summary-row__error" role="alert">{error}</small>}
    </div>
    <div className="summary-row__actions">
      <button type="button" className="btn btn-primary compact" disabled={busy || (written === 0)} onClick={download}><Download size={15} aria-hidden="true" />{t(busy ? "summary.receiving" : "summary.download")}</button>
      {summary.document.available
        ? <Link className="btn btn-soft compact" to={`${to}?summary=${encodeURIComponent(summary.id)}`} state={{ studyMode: "normal" }}><ExternalLink size={15} aria-hidden="true" />{t("summary.openSummary")}</Link>
        : <small>{t("summary.unavailable")}</small>}
    </div>
  </li>;
}

/** Materials → My summaries: every summary the student has written, newest first. */
export default function MySummariesList() {
  const { t } = useI18n();
  const [state, setState] = useState(/** @type {{ items: any[] | null, error: string }} */ ({ items: null, error: "" }));
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    let active = true;
    sheetSummariesApi.list()
      .then((items) => { if (active) setState({ items, error: "" }); })
      .catch((failure) => { if (active) setState({ items: null, error: failure?.message || t("summary.loadFailed") }); });
    return () => { active = false; };
  }, [attempt, t]);
  if (state.error) return <ErrorPanel message={state.error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (!state.items) return <LoadingPanel variant="material-list" />;
  if (!state.items.length) return <EmptyState icon="study" title={t("summary.mine")} text={t("summary.mineEmpty")} />;
  const subjects = [...new Map(state.items.map(item => [item.document.material_slug, item.document.material_title || item.document.title])).entries()];
  const needle = query.trim().toLocaleLowerCase();
  const items = state.items.filter(item => (!subject || item.document.material_slug === subject)
    && (!status || item.status === status)
    && (!needle || [item.title, item.document.title, item.document.material_title].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle)));
  return <>
    <div className="summary-filters">
      <label className="field"><span>{t("summary.search")}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="field"><span>{t("summary.subject")}</span><select value={subject} onChange={event => setSubject(event.target.value)}><option value="">{t("summary.allSubjects")}</option>{subjects.map(([slug, title]) => <option key={slug} value={slug}>{title}</option>)}</select></label>
      <label className="field"><span>{t("summary.status")}</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="">{t("summary.allStatuses")}</option><option value="writing">{t("summary.writing")}</option><option value="finished">{t("summary.finished")}</option></select></label>
    </div>
    <p role="status">{t("summary.resultCount", { count: items.length })}</p>
    {items.length ? <ul className="summary-rows">{items.map(summary => <SummaryRow key={summary.id} summary={summary} />)}</ul> : <EmptyState title={t("summary.noMatches")} text={t("summary.changeFilters")} />}
  </>;
}
