import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { biweeklyApi } from "../../api/biweekly.js";
import { Icon } from "../../lib/icons.jsx";
import { useI18n } from "../I18nProvider.jsx";

const SEEN_KEY = "lock-in.weekly-summary.seen";

function readSeen() {
  try { return window.localStorage.getItem(SEEN_KEY) || ""; } catch { return ""; }
}

function writeSeen(id) {
  try { window.localStorage.setItem(SEEN_KEY, id); } catch { /* the card simply shows again next visit */ }
}

/**
 * Tells the student their weekly summary is ready once per closed week. The
 * card is a convenience: the summary also stays in Analysis and Review history.
 */
export function WeeklyReadyToast() {
  const { t } = useI18n();
  const [latestId, setLatestId] = useState("");

  useEffect(() => {
    let cancelled = false;
    biweeklyApi.history("analysis").then((response) => {
      const latest = response?.history?.[0];
      if (!cancelled && latest && latest.id !== readSeen()) setLatestId(latest.id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!latestId) return null;
  const dismiss = () => { writeSeen(latestId); setLatestId(""); };
  return <div className="reminder-toast weekly-ready-toast" role="status" aria-live="polite">
    <span className="stat-icon"><Icon name="calendar" size={16} /></span>
    <div>
      <p className="eyebrow">{t("weekly.eyebrow")}</p>
      <strong>{t("weekly.ready")}</strong>
      <Link className="btn btn-primary compact" to="/weekly-summary" onClick={dismiss}>{t("weekly.open")}</Link>
    </div>
    <button className="icon-btn" type="button" onClick={dismiss} aria-label={t("weekly.dismiss")}><Icon name="x" size={17} /></button>
  </div>;
}
