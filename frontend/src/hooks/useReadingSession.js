import { useEffect, useRef } from "react";
import { focusApi } from "../api/focus.js";

/**
 * Report a reading sitting to the server, so studying counts as a study day.
 *
 * The streak is built from `StreakActivity` rows, and a reading sitting used to
 * produce none: the catalog reader never opened a Focus session, so the only
 * flow that could record `focus.deep_session` was Lock In. A reader could open
 * a sheet every day for a month and the streak stayed at zero -- not because
 * the streak rules were wrong, but because nothing ever told the server they
 * had studied.
 *
 * What is reported is deliberately only "opened" and "closed". The duration,
 * the twenty-minute threshold and the day boundary all stay on the server,
 * which measures the session from its own activity log, so a client cannot
 * claim a study day it did not earn.
 */

function newClientInstanceId() {
  const random = globalThis.crypto;
  if (typeof random?.randomUUID === "function") return random.randomUUID();
  // A stable-enough fallback: this identifier only has to be unique per open
  // reader, and the server treats a repeat as the same sitting.
  return `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`;
}

/**
 * @param {string} documentVersionId The server document the reader has open.
 * @param {{ enabled?: boolean }} [options] `enabled: false` reports nothing,
 * which is what a Sheet Summary and a fixture sheet both want.
 */
export function useReadingSession(documentVersionId, { enabled = true } = {}) {
  const sessionIdRef = useRef("");

  useEffect(() => {
    if (!enabled || !documentVersionId) return undefined;
    let active = true;
    sessionIdRef.current = "";

    focusApi
      .startSession({ documentVersionId, clientInstanceId: newClientInstanceId() })
      .then((payload) => {
        const id = String(payload?.id || "");
        if (!active) {
          // The reader left before the session came back. Close it now rather
          // than leaving it open for the next sitting to settle.
          if (id) void focusApi.sessionAction(id, "complete").catch(() => {});
          return;
        }
        sessionIdRef.current = id;
      })
      // Reading must never depend on this. A reader whose session could not be
      // opened keeps their sheet; they lose a streak day, not their study.
      .catch(() => {});

    function close() {
      const id = sessionIdRef.current;
      if (!id) return;
      sessionIdRef.current = "";
      void focusApi.sessionAction(id, "complete").catch(() => {});
    }

    // `pagehide` is the last event a closing or backgrounded tab reliably gets,
    // and on iOS it is the only one. A tab that dies before this still counts:
    // the server settles an open sitting at its last recorded activity when the
    // reader next opens a sheet.
    globalThis.addEventListener?.("pagehide", close);
    return () => {
      active = false;
      globalThis.removeEventListener?.("pagehide", close);
      close();
    };
  }, [documentVersionId, enabled]);
}
