import { useCallback, useEffect, useState } from "react";
import { companionPreferenceKey, readCompanionPreferences, saveCompanionPreferences } from "../lib/studyAssistance.js";

export function useCompanionPreferences(userId) {
  const [stored, setStored] = useState(() => ({ userId, value: readCompanionPreferences(userId) }));
  const preferences = stored.userId === userId ? stored.value : readCompanionPreferences(userId);
  useEffect(() => {
    const refresh = (event) => {
      if (event.type === "storage" && event.key !== null && event.key !== companionPreferenceKey(userId)) return;
      if (event.type !== "storage" && event.detail.userId !== userId) return;
      setStored({ userId, value: event.detail?.preferences || readCompanionPreferences(userId) });
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("lockin:companion-preferences", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("lockin:companion-preferences", refresh);
    };
  }, [userId]);
  const update = useCallback((change) => {
    setStored((current) => {
      const previous = current.userId === userId ? current.value : readCompanionPreferences(userId);
      return { userId, value: typeof change === "function" ? change(previous) : change };
    });
  }, [userId]);
  useEffect(() => {
    if (stored.userId === userId) saveCompanionPreferences(userId, stored.value);
  }, [stored, userId]);
  return [preferences, update];
}
