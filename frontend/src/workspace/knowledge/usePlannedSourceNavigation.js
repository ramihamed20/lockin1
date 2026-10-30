import { useEffect, useRef } from "react";

export function plannedSourcePage(search, source, limit) {
  const value = search.get("studyPage");
  if (!value || !/^[1-9]\d{0,4}$/.test(value)) return null;
  return Number(value) <= limit && search.get("studyVersion") === source?.versionId && search.get("studyFile") === source?.fileId ? Number(value) : null;
}
export function usePlannedSourceNavigation({ search, source, limit, ready, onRead, onUnavailable, onExplain, onActive }) {
  const handled = useRef("");
  const actions = useRef({ onRead, onUnavailable, onExplain, onActive });
  actions.current = { onRead, onUnavailable, onExplain, onActive };
  const request = search.toString();
  useEffect(() => {
    if (!ready || !source?.id || !search.has("studyPage")) return;
    const identity = `${source.id}:${request}`;
    if (handled.current === identity) return;
    handled.current = identity;
    const page = plannedSourcePage(search, source, limit);
    if (!page) { actions.current.onUnavailable(); return; }
    if (search.get("studyActivity") === "active_study") {
      const difficulty = search.get("studyDifficulty");
      if (["easy", "medium", "hard"].includes(difficulty)) actions.current.onActive?.(difficulty);
      return;
    }
    actions.current.onRead(page);
    const question = search.get("studyQuestion");
    if (question && /^[a-f0-9-]{36}$/i.test(question)) actions.current.onExplain?.(question);
  }, [ready, source, search, limit, request]);
}
