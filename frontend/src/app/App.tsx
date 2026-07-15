import { useEffect, useState } from "react";

import { getApiHealth } from "../api/client";
import { applyPwaUpdate, usePwaStatus } from "../pwa/update";

type ApiState = "checking" | "available" | "unavailable";

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}

export function App() {
  const [apiState, setApiState] = useState<ApiState>("checking");
  const online = useOnlineStatus();
  const pwa = usePwaStatus();

  useEffect(() => {
    const controller = new AbortController();
    void getApiHealth(controller.signal)
      .then(() => setApiState("available"))
      .catch(() => {
        if (!controller.signal.aborted) {
          setApiState("unavailable");
        }
      });
    return () => controller.abort();
  }, []);

  const apiLabel = {
    checking: "Checking",
    available: "Available",
    unavailable: "Unavailable"
  }[apiState];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Lock-in home">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span>Lock-in</span>
        </a>
        <span className="phase-label">Foundation</span>
      </header>

      <main className="foundation-main">
        <section className="intro" aria-labelledby="foundation-title">
          <p className="context-line">A dedicated university study workspace</p>
          <h1 id="foundation-title">Built for the hours that matter.</h1>
          <p className="intro-copy">
            The secure, mobile-first foundation is in place. Study workflows and the full Focus
            workspace will be added one reviewed phase at a time.
          </p>
        </section>

        <section className="status-panel" aria-labelledby="status-title">
          <div className="status-heading">
            <h2 id="status-title">Foundation status</h2>
            <span className="status-dot" data-online={online} aria-hidden="true" />
          </div>
          <dl className="status-list" aria-live="polite">
            <div>
              <dt>Device connection</dt>
              <dd>{online ? "Online" : "Offline"}</dd>
            </div>
            <div>
              <dt>Lock-in API</dt>
              <dd data-state={apiState}>{apiLabel}</dd>
            </div>
            <div>
              <dt>Offline shell</dt>
              <dd>{pwa.offlineReady ? "Ready" : "Prepared"}</dd>
            </div>
          </dl>
          <p className="status-note">
            Private account and study data are never stored in the shared PWA cache.
          </p>
        </section>
      </main>

      {pwa.updateAvailable ? (
        <aside className="update-notice" aria-live="polite">
          <p>A safer Lock-in update is ready.</p>
          <button type="button" onClick={() => void applyPwaUpdate()}>
            Update now
          </button>
        </aside>
      ) : null}
    </div>
  );
}
