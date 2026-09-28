import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../components/I18nProvider.jsx";
import { downloadOfflineItem, fetchOfflineManifest, offlineItemState, readOfflineManifest, sheetEditionItems } from "./downloads.js";

/**
 * Compact per-edition shortcut; the Settings page remains the full manager.
 * It downloads everything the edition needs (PDF, Active Study with its
 * checkpoints and final exam, summary, question banks) and says "Available
 * Offline" only once every one of them is stored at its current version.
 */
export default function OfflineSheetAction({ userId, materialSlug, sheetSlug, edition }) {
  const { t } = useI18n();
  const [items, setItems] = useState([]);
  const [state, setState] = useState("loading");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!userId) return;
    let manifest = await readOfflineManifest(userId);
    if (!manifest && navigator.onLine) manifest = await fetchOfflineManifest(userId);
    const selected = sheetEditionItems(manifest, { materialSlug, sheetSlug, edition });
    setItems(selected);
    if (!selected.length) { setState("unavailable"); return; }
    const states = await Promise.all(selected.map((item) => offlineItemState(userId, item, manifest)));
    setState(states.every((value) => value === "downloaded") ? "downloaded"
      : states.some((value) => value === "incomplete") || (states.some((value) => value === "downloaded") && states.some((value) => value === "download")) ? "incomplete"
        : states.some((value) => value === "update") ? "update" : "download");
  }, [userId, materialSlug, sheetSlug, edition]);

  useEffect(() => {
    void refresh().catch(() => setState("unavailable"));
    const sync = (event) => { if (event.detail?.userId === userId && ["synced", "partial"].includes(event.detail.state)) void refresh(); };
    window.addEventListener("lock-in:offline-sync", sync);
    return () => window.removeEventListener("lock-in:offline-sync", sync);
  }, [refresh, userId]);

  async function download() {
    if (!items.length || !userId) return;
    setState("downloading");
    setError("");
    const manifest = await readOfflineManifest(userId);
    let failure = null;
    for (const [index, item] of items.entries()) {
      try {
        await downloadOfflineItem(userId, item, (value) => setProgress((index + value) / items.length), { manual: true, manifest });
      } catch (cause) { failure ||= cause; }
    }
    setProgress(0);
    await refresh().catch(() => setState("incomplete"));
    if (failure) setError(failure.message);
  }

  if (state === "loading" || state === "unavailable") return null;
  const label = state === "downloaded" ? t("offline.availableOffline")
    : state === "incomplete" ? t("offline.incomplete")
      : state === "update" ? t("offline.updateAvailable")
        : state === "downloading" ? `${t("offline.downloading")} ${Math.round(progress * 100)}%`
          : t("offline.downloadForOffline");
  return <span className="offline-sheet-action"><button type="button" className="btn btn-soft compact" onClick={download} disabled={state === "downloaded" || state === "downloading" || !navigator.onLine}>{label}</button>{error && <small role="alert">{error}</small>}</span>;
}
