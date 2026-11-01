import "./study-assistance-admin.css";
import { useEffect, useState } from "react";
import { useI18n } from "../../components/I18nProvider.jsx";
import { studyAssistanceAdminApi } from "../../api/studyAssistance.js";

const emptyIdea = () => ({ id: "", page: "", kind: "understand", teaser: "", question: "", explanation: "", followup_question: "", followup_answer: "", position: 0, is_published: false, revision: 1 });
const TEXT_FIELDS = /** @type {Array<[string, number, number]>} */ ([
  ["question", 1000, 2], ["explanation", 5000, 5], ["followup_question", 1000, 2], ["followup_answer", 3000, 4]
]);

export function StudyAssistancePanel({ sheet }) {
  const { t } = useI18n();
  const [edition, setEdition] = useState("university"), [view, setView] = useState("study");
  const [data, setData] = useState({ key: "", results: [], version_id: "", available: false, page_count: null });
  const [draft, setDraft] = useState(emptyIdea);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const key = [sheet.id, edition, view].join("/");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setMessage(""); setDraft(emptyIdea());
    studyAssistanceAdminApi.list(sheet.id, { edition, view, signal: controller.signal }).then((body) => {
      if (!controller.signal.aborted) { setData({ ...body, key }); setLoading(false); }
    }, () => { if (!controller.signal.aborted) { setError(t("studyCompanion.admin.loadFailed")); setLoading(false); } });
    return () => controller.abort();
  // The request is scoped by sheet/edition/view; translation changes do not reload a draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sheet.id, edition, view]);
  const ready = !loading && data.key === key && data.available;
  const rows = data.key === key ? data.results : [];
  function change(name, value) { setDraft((current) => ({ ...current, [name]: value })); setMessage(""); }
  async function save(event) {
    event.preventDefault();
    if (pending || !ready) return;
    setPending(true); setError(""); setMessage("");
    const body = {
      source_version_id: data.version_id, edition, view,
      page: draft.page === "" ? null : Number(draft.page),
      kind: draft.kind, teaser: draft.teaser, question: draft.question,
      explanation: draft.explanation, followup_question: draft.followup_question,
      followup_answer: draft.followup_answer, position: Number(draft.position),
      is_published: draft.is_published,
      ...(draft.id ? { expected_revision: draft.revision } : {})
    };
    try {
      const saved = await studyAssistanceAdminApi.save(sheet.id, draft.id, body);
      setData((current) => ({ ...current, results: [...current.results.filter((row) => row.id !== saved.id), saved].sort((a, b) => a.position - b.position) }));
      setDraft({ ...saved, page: saved.page ?? "" });
      setMessage(t("studyCompanion.admin.saved"));
    } catch (failure) { setError(failure?.message || t("studyCompanion.saveFailed")); }
    finally { setPending(false); }
  }
  return <section className="admin-assistance" aria-label={t("studyCompanion.admin.title")}>
    <header><h4>{t("studyCompanion.admin.title")}</h4><p>{t("studyCompanion.admin.description")}</p></header>
    <div className="admin-assistance-scopes">
      <label className="field"><span>{t("studyCompanion.admin.edition")}</span><select disabled={pending} value={edition} onChange={(event) => setEdition(event.target.value)}><option value="university">{t("studyCompanion.admin.university")}</option><option value="lockin">{t("studyCompanion.admin.lockin")}</option></select></label>
      <label className="field"><span>{t("studyCompanion.admin.view")}</span><select disabled={pending} value={view} onChange={(event) => setView(event.target.value)}><option value="study">{t("studyCompanion.admin.study")}</option><option value="summary">{t("studyCompanion.admin.summary")}</option></select></label>
    </div>
    {loading && <p role="status">{t("studyCompanion.loading")}</p>}
    {error && <p className="form-alert error" role="alert">{error}</p>}
    {message && <p className="form-alert success" role="status">{message}</p>}
    {!loading && data.key === key && !data.available && <p className="form-alert">{t("studyCompanion.admin.addPdf")}</p>}
    {ready && <>
      <div className="admin-assistance-list">{rows.length ? rows.map((row) => <button type="button" key={row.id} disabled={pending} onClick={() => { setDraft({ ...row, page: row.page ?? "" }); setError(""); setMessage(""); }} aria-pressed={draft.id === row.id}><span dir="auto">{row.question}</span><small>{row.page === null ? t("studyCompanion.admin.sheetWide") : t("studyCompanion.admin.page") + " " + row.page} · {t(row.is_published ? "studyCompanion.admin.published" : "studyCompanion.admin.draft")}</small></button>) : <p>{t("studyCompanion.admin.empty")}</p>}</div>
      <button type="button" className="btn btn-soft" disabled={pending} onClick={() => { setDraft({ ...emptyIdea(), position: rows.length ? Math.max(...rows.map((row) => row.position)) + 1 : 0 }); setError(""); setMessage(""); }}>{t("studyCompanion.admin.new")}</button>
      <form onSubmit={save} className="admin-assistance-form">
        <h5>{t(draft.id ? "studyCompanion.admin.edit" : "studyCompanion.admin.new")}</h5>
        <fieldset disabled={pending}>
          <div className="admin-assistance-scopes">
            <label className="field"><span>{t("studyCompanion.admin.page")}</span><input type="number" min="1" max={data.page_count || 10000} value={draft.page} onChange={(event) => change("page", event.target.value)} /><small>{t("studyCompanion.admin.pageHint")}</small></label>
            <label className="field"><span>{t("studyCompanion.admin.kind")}</span><select value={draft.kind} onChange={(event) => change("kind", event.target.value)}>{["understand", "memory", "organize"].map((kind) => <option key={kind} value={kind}>{t("studyCompanion.admin." + kind)}</option>)}</select></label>
          </div>
          <label className="field"><span>{t("studyCompanion.admin.teaser")}</span><input value={draft.teaser} required maxLength={240} dir="auto" onChange={(event) => change("teaser", event.target.value)} /></label>
          {TEXT_FIELDS.map(([name, limit, lines]) => <label key={name} className="field"><span>{t("studyCompanion.admin." + name)}</span><textarea required value={draft[name]} rows={lines} maxLength={limit} dir="auto" onChange={(event) => change(name, event.target.value)} /></label>)}
          <div className="admin-assistance-scopes">
            <label className="field"><span>{t("studyCompanion.admin.position")}</span><input type="number" min="0" max="1000000" value={draft.position} onChange={(event) => change("position", event.target.value)} required /></label>
            <label className="field"><span>{t("studyCompanion.admin.publication")}</span><select value={draft.is_published ? "published" : "draft"} onChange={(event) => change("is_published", event.target.value === "published")}><option value="draft">{t("studyCompanion.admin.draft")}</option><option value="published">{t("studyCompanion.admin.published")}</option></select></label>
          </div>
          <button type="submit" className="btn btn-primary" aria-busy={pending}>{t(pending ? "studyCompanion.saving" : "studyCompanion.admin.save")}</button>
        </fieldset>
      </form>
    </>}
  </section>;
}
