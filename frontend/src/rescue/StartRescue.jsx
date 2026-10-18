import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { useStartRescue } from "./useStartRescue.js";
import { TARGET_SECONDS, TERMINAL, sameRescueSource } from "./model.js";
import "./rescue.css";

export default function StartRescue({ userId, source, page, pageLimit, ready, blocked, toolsEnabled, onActivity }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const panel = useRef(null);
  const closeRef = useRef(null);
  const requested = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();
  const initialPage = Number(location.state?.rescuePage);
  const requestPage = useRef(Number.isSafeInteger(initialPage) && initialPage >= 1 ? initialPage : null);
  const rescue = useStartRescue(userId, source, requestPage.current ?? page, pageLimit, ready, blocked, toolsEnabled, (activity) => {
    const result = onActivity({ ...activity, open_source: requestPage.current !== null });
    if (result !== false) requestPage.current = null;
    return result;
  });
  useEffect(() => {
    if (!location.state?.startRescue || requested.current || !ready || !rescue.loaded) return;
    requested.current = true;
    setOpen(true);
    void rescue.propose();
    navigate(location.pathname, { replace: true, state: { ...location.state, startRescue: false } });
  }, [location, navigate, ready, rescue]);
  const record = rescue.record;
  const ended = record && TERMINAL.has(record.status);
  const reached = record?.active_duration_seconds >= TARGET_SECONDS;
  const here = !record || sameRescueSource(record, source);
  const remaining = Math.max(0, TARGET_SECONDS - Math.floor(record?.active_duration_seconds || 0));
  const duration = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const close = async () => {
    if (record?.status === "proposed") await rescue.transition("stop", "user_stop");
    else if (record?.status === "active") await rescue.transition("pause", "user_pause");
    setOpen(false);
    trigger.current?.focus();
  };
  closeRef.current = close;
  useEffect(() => {
    const element = panel.current;
    const key = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); void closeRef.current?.(); }
    };
    element?.addEventListener("keydown", key);
    if (open) element?.focus();
    return () => element?.removeEventListener("keydown", key);
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="rescue-trigger" data-rescue-trigger="" aria-expanded={open} aria-controls="start-rescue-panel" disabled={(!ready && !record) || !rescue.loaded} onClick={() => { if (open) void close(); else { setOpen(true); void rescue.propose(); } }}>
      {t("rescue.title")}{record && !ended && record.status !== "proposed" && <span aria-hidden="true"> · {record.status === "active" ? duration : t("rescue.paused")}</span>}
    </button>
    {open && createPortal(<div ref={panel} id="start-rescue-panel" className="rescue-panel" role="dialog" aria-modal="false" tabIndex={-1} aria-label={t("rescue.title")}>
      <header><h2>{t("rescue.title")}</h2><button type="button" aria-label={t("common.close")} onClick={() => { void close(); }}>×</button></header>
      <p>{t("rescue.optional")}</p>
      {rescue.loading && <p role="status">{t("common.loading")}</p>}
      {rescue.error && <p role="alert">{t(rescue.error)}</p>}
      {record && !ended && !here && <p>{t("rescue.otherSource")}</p>}
      {record && !ended && here && <>
        <p className="rescue-task" dir="auto"><strong>{t(`rescue.task_${record.task_type}`)}</strong><span>{record.title || t("rescue.source")} · {t("rescue.page", { page: record.page_start })}</span></p>
        {record.status === "proposed" ? <>
          <div className="rescue-actions"><button type="button" className="btn btn-primary compact" disabled={!ready || blocked || !rescue.saved || Boolean(rescue.error)} onClick={() => { void rescue.transition("start"); }}>{t("rescue.start")}</button>
            {rescue.activities.length > 1 && <button type="button" className="btn btn-soft compact" onClick={() => { void rescue.choose((rescue.activities.findIndex((item) => item.task_type === record.task_type) + 1) % rescue.activities.length); }}>{t("rescue.another")}</button>}</div>
        </> : <>
          <output className="rescue-time" aria-label={t("rescue.timeRemaining")} aria-live="off" dir="ltr">{duration}</output>
          <p role="status">{t(reached ? "rescue.targetReached" : record.status === "paused" ? "rescue.pausedHint" : "rescue.running")}</p>
          <div className="rescue-actions">
            {!reached && <button type="button" className="btn btn-soft compact" disabled={Boolean(rescue.error)} onClick={() => { void rescue.transition(record.status === "active" ? "pause" : "resume", "user_pause"); }}>{t(record.status === "active" ? "rescue.pause" : "rescue.resume")}</button>}
            <button type="button" className="btn btn-primary compact" onClick={() => { void rescue.transition("continue", "continue").then(() => setOpen(false)); }}>{t("rescue.continue")}</button>
          </div>
        </>}
      </>}
      {record && !ended && <div className="rescue-actions">
        <button type="button" className="btn btn-soft compact" onClick={() => { void rescue.transition(reached ? "finish" : "stop", reached ? "enough_today" : "user_stop"); }}>{t(reached ? "rescue.enough" : "rescue.stop")}</button>
        {record.status !== "proposed" && here && <button type="button" className="btn btn-soft compact" onClick={() => { void rescue.transition("stop", "changed_task").then(() => rescue.propose()); }}>{t("rescue.change")}</button>}
      </div>}
      {ended && <p role="status">{t(record.status === "continued" ? "rescue.continued" : "rescue.stopped")}</p>}
      {record && <p className="rescue-save" role="status">{t(rescue.saved ? "rescue.saved" : "rescue.saving")}</p>}
    </div>, trigger.current?.closest(".workspace-v2") || document.body)}
  </>;
}
