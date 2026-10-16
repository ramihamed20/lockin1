import { useEffect, useState } from "react";
import { knowledgeApi } from "../../api/knowledge.js";
import { captureOfflineSession } from "../../offline/sessionScope.js";

export function useMcqExplainLinks(userId, documentId, attemptId, enabled) {
  const context = `${userId}/${documentId}/${attemptId}`;
  const [state, setState] = useState({ context: "", links: [], availability: "loading" });
  useEffect(() => {
    if (!enabled || !userId || !documentId || !attemptId) return undefined;
    let active = true;
    const current = captureOfflineSession(userId);
    knowledgeApi.mcqLinks(documentId, attemptId).then((response) => {
      if (active && current.isCurrent()) setState({ context, ...response });
    }).catch(() => {
      if (active && current.isCurrent()) setState({ context, links: [], availability: "unavailable" });
    });
    return () => { active = false; };
  }, [context, userId, documentId, attemptId, enabled]);
  return state.context === context ? state : { links: [], availability: "loading" };
}
