import { captureOfflineSession } from "../offline/sessionScope.js";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { rescueApi } from "../api/rescue.js";
import { useI18n } from "../components/I18nProvider.jsx";

export default function RescueEntry({ userId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    const assertCurrent = captureOfflineSession(userId);
    setBusy(true); setError("");
    try {
      const { activities } = await rescueApi.suggestions();
      assertCurrent();
      if (!activities?.length) { setError("rescue.openSheet"); return; }
      navigate(activities[0].path, { state: { startRescue: true, rescuePage: activities[0].page_start } });
    } catch { setError("rescue.openSheet"); }
    finally { setBusy(false); }
  }
  return <section className="rescue-entry">
    <div><h2>{t("rescue.title")}</h2><p>{t("rescue.entryHint")}</p></div>
    <button type="button" className="btn btn-soft compact" disabled={busy} onClick={() => { void open(); }}>{t(busy ? "common.loading" : "rescue.open")}</button>
    {error && <p role="status">{t(error)}</p>}
  </section>;
}
