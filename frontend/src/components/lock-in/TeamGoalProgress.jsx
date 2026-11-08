import { useEffect, useId, useRef, useState } from "react";
import { acquireBodyScrollLock } from "../../lib/bodyScrollLock.js";
import { Pencil } from "lucide-react";
import { useI18n } from "../I18nProvider.jsx";
import { lockInMemberName } from "../../pages/LockInLobby.jsx";

function GoalEditor({ goal, onSave, onClose, onRefresh, returnFocusRef }) {
  const { t } = useI18n();
  const dialog = useRef(null);
  const saving = useRef(false);
  const id = useId();
  const [revision] = useState(goal?.revision ?? 1);
  const [pages, setPages] = useState(goal?.pages ?? "");
  const [done, setDone] = useState(goal?.completed ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current;
    const trigger = returnFocusRef.current;
    const release = acquireBodyScrollLock();
    node.showModal();
    return () => { node.close(); release(); trigger?.focus({ preventScroll: true }); };
  }, [returnFocusRef]);
  async function submit(event) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      await onSave({ goalPages: Number(pages), completedPages: Number(done), expectedRevision: revision });
      onClose();
    } catch (failure) {
      setError(failure.status === 409 ? t("lockIn.goalChanged") : t("lockIn.updateFailed"));
      if (failure.status === 409) void onRefresh();
    } finally { saving.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="lm-goal-editor" aria-labelledby={`${id}-title`} aria-describedby={`${id}-shared`} onCancel={(event) => { event.preventDefault(); if (!saving.current) onClose(); }}>
    <form onSubmit={submit} aria-busy={busy}>
      <h2 id={`${id}-title`}>{t("lockIn.editGoal")}</h2>
      <p id={`${id}-shared`}>{t("lockIn.goalShared")}</p>
      <label htmlFor={`${id}-pages`}>{t("lockIn.goalPages")}</label>
      <input id={`${id}-pages`} type="number" inputMode="numeric" dir="ltr" min="1" max="10000" step="1" required value={pages} disabled={busy} onChange={(event) => setPages(event.target.value)} />
      <label htmlFor={`${id}-done`}>{t("lockIn.completedPages")}</label>
      <input id={`${id}-done`} type="number" inputMode="numeric" dir="ltr" min="0" max={Number(pages) || 0} step="1" required value={done} disabled={busy} onChange={(event) => setDone(event.target.value)} />
      {error && <p className="lm-error" role="alert">{error}</p>}
      <div className="lm-goal-actions">
        <button className="btn btn-soft" type="button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
        <button className="btn btn-primary" type="submit" disabled={busy}>{t("lockIn.save")}</button>
      </div>
    </form>
  </dialog>;
}

/** Shared, self-reported pages, independent of presence, timing and rankings. */
export function TeamGoalProgress({ payload, onSave, onRefresh }) {
  const { t } = useI18n();
  const ownButton = useRef(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const { participants = [], team } = payload;
  const own = participants.find(member => member.member_id === team?.self_member_id);
  return <section className="lm-team-goals" aria-label={t("lockIn.goalProgress")}>
    <ul>{participants.map(member => {
      const name = lockInMemberName(member, t);
      const goal = member.goal;
      const content = <>
        <strong><span dir="auto">{name}</span>{member.member_id === team?.self_member_id && <Pencil size={12} aria-hidden="true" />}</strong>
        <span className="lm-goal-numbers" dir="ltr">{goal?.pages ? `${goal.completed} / ${goal.pages}` : member.member_id === team?.self_member_id ? <span dir="auto">{t("lockIn.setGoal")}</span> : "—"}</span>
        {goal?.pages ? <progress max={goal.pages} value={goal.completed} aria-label={`${name}: ${t("lockIn.goalPageProgress", { done: goal.completed, total: goal.pages })}`} /> : <span className="lm-goal-empty" aria-hidden="true" />}
      </>;
      return <li key={member.member_id}>{member.member_id === team?.self_member_id
        ? <button ref={ownButton} className="lm-goal-member" type="button" aria-label={t(goal?.pages ? "lockIn.editGoal" : "lockIn.setGoal")} onClick={() => { setSaved(false); setEditing(true); }}>{content}</button>
        : <div className="lm-goal-member">{content}</div>}</li>;
    })}</ul>
    <span className="visually-hidden" role="status">{saved ? t("lockIn.goalSaved") : ""}</span>
    {editing && own && <GoalEditor returnFocusRef={ownButton} goal={own.goal} onSave={async (values) => { await onSave(values); setSaved(true); }} onRefresh={onRefresh} onClose={() => setEditing(false)} />}
  </section>;
}
