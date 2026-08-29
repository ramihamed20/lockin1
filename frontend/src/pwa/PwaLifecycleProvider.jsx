import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Icon } from "../lib/icons.jsx";
import { assetPath } from "../lib/utils.js";
import { useI18n } from "../components/I18nProvider.jsx";
import {
  getInstallSnapshot,
  promptForPwaInstall,
  pwaDebug,
  subscribeToInstallEvents
} from "./installEvents.js";
import {
  clearPwaDismissal,
  detectPwaPlatform,
  hasActivePwaDismissal,
  hasInstalledPwaMemory,
  rememberPwaDismissal,
  rememberPwaInstalled
} from "./platform.js";
import { FINAL_PWA_LAUNCH_STATES, resolvePwaLaunchState } from "./launchState.js";

const PwaLifecycleContext = createContext(null);

function initialLaunchState(platform, installSnapshot) {
  return resolvePwaLaunchState({
    ...platform,
    installedMemory: hasInstalledPwaMemory(),
    dismissed: hasActivePwaDismissal(),
    serviceWorkerStatus: import.meta.env.PROD && "serviceWorker" in navigator ? "checking" : "unsupported",
    documentReady: document.readyState === "complete",
    promptAvailable: Boolean(installSnapshot.prompt)
  });
}

function monitorWorkerState(registration) {
  if (!import.meta.env?.DEV || !registration) return;
  const workers = [registration.installing, registration.waiting, registration.active].filter(Boolean);
  workers.forEach((worker) => {
    pwaDebug("Service worker state", worker.state);
    worker.addEventListener("statechange", () => pwaDebug("Service worker state", worker.state));
  });
}

function useDocumentReady() {
  const [ready, setReady] = useState(() => document.readyState === "complete");
  useEffect(() => {
    if (document.readyState === "complete") {
      setReady(true);
      return undefined;
    }
    const onLoad = () => setReady(true);
    window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return ready;
}

function PwaLaunchScreen({ status, platform, busy, error, onInstall, onContinue }) {
  const { t } = useI18n();
  const headingRef = useRef(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const content = {
    checking: ["pwa.checking.title", "pwa.checking.body"],
    installable: ["pwa.installable.title", "pwa.installable.body"],
    "ios-instructions": ["pwa.ios.title", platform.safari ? "pwa.ios.safariBody" : "pwa.ios.browserBody"],
    "manual-install": ["pwa.manual.title", "pwa.manual.body"],
    unsupported: ["pwa.unsupported.title", "pwa.unsupported.body"],
    error: ["pwa.error.title", "pwa.error.body"]
  }[status] || ["pwa.checking.title", "pwa.checking.body"];

  const continueLabel = platform.ios && platform.safari ? t("pwa.continueSafari") : t("pwa.continueBrowser");
  const showIosSteps = status === "ios-instructions";
  const showManualSteps = status === "manual-install";

  return (
    <section className="pwa-launch-screen" role="dialog" aria-modal="true" aria-labelledby="pwa-launch-title">
      <div className="pwa-launch-shell">
        <header className="pwa-launch-brand" aria-label={t("app.name")}>
          <img src={assetPath("/icons/lockin-light-192-v2.png")} alt="" draggable="false" />
          <strong>lock-in</strong>
        </header>

        <div className="pwa-launch-copy" aria-live="polite">
          <h1 id="pwa-launch-title" ref={headingRef} tabIndex={-1}>{t(content[0])}</h1>
          <p>{error || t(content[1])}</p>
        </div>

        {status === "checking" && (
          <div className="pwa-launch-check" role="status">
            <span className="pwa-launch-progress" aria-hidden="true"><span /></span>
            <span>{t("pwa.checking.status")}</span>
          </div>
        )}

        {status === "installable" && (
          <ul className="pwa-launch-benefits" aria-label={t("pwa.benefitsLabel")}>
            {["pwa.benefit.launch", "pwa.benefit.fullscreen", "pwa.benefit.offline"].map((key) => (
              <li key={key}><Icon name="check" size={18} />{t(key)}</li>
            ))}
          </ul>
        )}

        {(showIosSteps || showManualSteps) && (
          <ol className="pwa-launch-steps">
            {(showIosSteps
              ? ["pwa.ios.step1", "pwa.ios.step2", "pwa.ios.step3"]
              : ["pwa.manual.step1", "pwa.manual.step2"]
            ).map((key) => <li key={key}>{t(key)}</li>)}
          </ol>
        )}

        <div className="pwa-launch-actions">
          {status === "installable" && (
            <button className="btn btn-primary" type="button" onClick={onInstall} disabled={busy}>
              <Icon name="plus" size={18} />
              {busy ? t("pwa.installing") : t("pwa.install")}
            </button>
          )}
          <button className={status === "installable" ? "btn btn-soft" : "btn btn-primary"} type="button" onClick={onContinue}>
            {continueLabel}
          </button>
        </div>

        <p className="pwa-launch-footnote">{t("pwa.optional")}</p>
      </div>
    </section>
  );
}

export function PwaLifecycleProvider({ children }) {
  const installSnapshot = useSyncExternalStore(subscribeToInstallEvents, getInstallSnapshot, getInstallSnapshot);
  const platform = useMemo(detectPwaPlatform, []);
  const documentReady = useDocumentReady();
  const [serviceWorkerStatus, setServiceWorkerStatus] = useState(() => (
    import.meta.env.PROD && "serviceWorker" in navigator ? "checking" : "unsupported"
  ));
  const [launchStatus, setLaunchStatus] = useState(() => initialLaunchState(platform, installSnapshot));
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState("");
  const appRootRef = useRef(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady],
    updateServiceWorker
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(swUrl, registration) {
      pwaDebug("Service worker registered", {
        script: swUrl,
        scope: registration?.scope,
        controller: navigator.serviceWorker.controller?.state || "not controlling yet"
      });
      monitorWorkerState(registration);
      navigator.serviceWorker.ready
        .then((readyRegistration) => {
          monitorWorkerState(readyRegistration);
          setServiceWorkerStatus("ready");
          pwaDebug("Service worker ready", {
            scope: readyRegistration.scope,
            state: readyRegistration.active?.state,
            controlling: Boolean(navigator.serviceWorker.controller)
          });
        })
        .catch((error) => {
          setServiceWorkerStatus("error");
          pwaDebug("Service worker readiness failed", error);
        });
    },
    onOfflineReady() {
      setServiceWorkerStatus("ready");
      pwaDebug("Offline app shell ready");
    },
    onRegisterError(error) {
      setServiceWorkerStatus("error");
      pwaDebug("Service worker registration failed", error);
    }
  });

  const showLaunchScreen = !FINAL_PWA_LAUNCH_STATES.has(launchStatus);

  useEffect(() => {
    pwaDebug("Platform detection", platform);
    pwaDebug("Standalone state", platform.standalone);
    if (platform.standalone) {
      rememberPwaInstalled();
      clearPwaDismissal();
    }

    const manifestLink = /** @type {HTMLLinkElement | null} */ (document.querySelector('link[rel="manifest"]'));
    if (import.meta.env?.DEV) {
      pwaDebug("PWA manifest", manifestLink?.href || "not injected in development mode");
      if (manifestLink?.href) {
        fetch(manifestLink.href)
          .then((response) => pwaDebug("PWA manifest response", {
            status: response.status,
            contentType: response.headers.get("content-type")
          }))
          .catch((error) => pwaDebug("PWA manifest request failed", error));
      }
    }
  }, [platform]);

  useEffect(() => {
    if (installSnapshot.installed) {
      rememberPwaInstalled();
      clearPwaDismissal();
      setInstallError("");
      setLaunchStatus("installed");
      return;
    }

    setLaunchStatus((current) => {
      if (current === "installed" && installSnapshot.prompt && !platform.standalone) {
        return resolvePwaLaunchState({
          ...platform,
          installedMemory: false,
          dismissed: false,
          serviceWorkerStatus,
          documentReady,
          promptAvailable: true
        });
      }
      if (FINAL_PWA_LAUNCH_STATES.has(current)) return current;
      return resolvePwaLaunchState({
        ...platform,
        installedMemory: false,
        dismissed: false,
        serviceWorkerStatus,
        documentReady,
        promptAvailable: Boolean(installSnapshot.prompt)
      });
    });
  }, [documentReady, installSnapshot, platform, serviceWorkerStatus]);

  useEffect(() => {
    const appRoot = appRootRef.current;
    if (!appRoot) return undefined;
    if (showLaunchScreen) {
      appRoot.setAttribute("inert", "");
      document.documentElement.dataset.pwaLaunch = "visible";
    } else {
      appRoot.removeAttribute("inert");
      delete document.documentElement.dataset.pwaLaunch;
    }
    return () => {
      appRoot.removeAttribute("inert");
      delete document.documentElement.dataset.pwaLaunch;
    };
  }, [showLaunchScreen]);

  async function installApp() {
    setInstallBusy(true);
    setInstallError("");
    try {
      const choice = await promptForPwaInstall();
      if (choice?.outcome === "accepted") {
        // appinstalled remains the authoritative success signal. The browser
        // owns the remaining installation UI, so the website can continue.
        setLaunchStatus("ready");
      } else {
        rememberPwaDismissal();
        setLaunchStatus("dismissed");
      }
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : "The browser install prompt is unavailable.");
      setLaunchStatus(platform.android ? "manual-install" : "error");
    } finally {
      setInstallBusy(false);
    }
  }

  function continueInBrowser() {
    rememberPwaDismissal();
    setInstallError("");
    setLaunchStatus("dismissed");
  }

  const lifecycleValue = useMemo(() => ({
    needRefresh,
    setNeedRefresh,
    offlineReady,
    serviceWorkerStatus,
    updateServiceWorker
  }), [needRefresh, offlineReady, serviceWorkerStatus, setNeedRefresh, updateServiceWorker]);

  return (
    <PwaLifecycleContext.Provider value={lifecycleValue}>
      <div className="pwa-app-root" ref={appRootRef} aria-hidden={showLaunchScreen ? "true" : undefined}>
        {children}
      </div>
      {showLaunchScreen && (
        <PwaLaunchScreen
          status={launchStatus}
          platform={platform}
          busy={installBusy}
          error={installError}
          onInstall={() => { void installApp(); }}
          onContinue={continueInBrowser}
        />
      )}
    </PwaLifecycleContext.Provider>
  );
}

export function usePwaLifecycle() {
  const context = useContext(PwaLifecycleContext);
  if (!context) throw new Error("usePwaLifecycle must be used inside PwaLifecycleProvider.");
  return context;
}
