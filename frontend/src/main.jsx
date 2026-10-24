// Layer order must be declared before any stylesheet reaches the document: a
// layer's position is fixed the first time it is named, so a component
// stylesheet pulled in through App.jsx would otherwise register `app` first
// and leave `primitives` ranked above it. Keep these imports at the top.
import "./styles/layers.css";
import "./styles.css";
import "./responsive.css";
import "./launch-readiness.css";
import "./styles/tokens.css";
import "./styles/system.css";
import "./styles/polish.css";
import "./styles/refine.css";
import "./styles/study-flow.css";
import "./styles/v2.css";
import "./styles/rail.css";
import "./styles/motion.css";
// Declared last: the interaction layer owns hover, press, focus and selection
// for the whole application, and layers — not import order — decide the winner
// even though route stylesheets load lazily.
import "./styles/interaction.css";
import "./styles/motion-system.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { I18nProvider, initialAppLocale } from "./components/I18nProvider.jsx";
import { RouteMetadataSync } from "./components/RouteMetadataSync.jsx";
import { PwaUpdatePrompt } from "./components/shared/PwaUpdatePrompt.jsx";
import { PwaLifecycleProvider } from "./pwa/PwaLifecycleProvider.jsx";
import { BUILD_INFO } from "./pwa/buildInfo.js";
import { installInteractionRuntime } from "./lib/interaction.js";
import { installViewportSync } from "./lib/viewport.js";
import { installClientErrorReporting } from "./lib/clientErrorReporting.js";
import { loadLocaleMessages } from "./lib/i18n.js";
import { authApi, prefetchSignInData } from "./lib/api.js";
import { getSessionMarker } from "./api/client.js";
import { startEarlySessionCheck } from "./lib/sessionBootstrap.js";

installInteractionRuntime();
// Installed before the first render so the keyboard token already has a value
// on the first painted frame. The application's height is owned by CSS, so the
// layout is never waiting on this.
installViewportSync();
installClientErrorReporting();
// `__LOCKIN_BUILD__` in the console answers "which build is this device on?"
// when diagnosing a stale deployment. Settings shows the same values.
window.__LOCKIN_BUILD__ = BUILD_INFO;

// The session check and this language's catalogue travel together; the static
// startup screen in index.html stays up until the catalogue can be read. If it
// cannot arrive at all, render anyway rather than hold the startup screen.
startEarlySessionCheck(authApi.me);
if (!getSessionMarker() && navigator.onLine !== false) prefetchSignInData();
loadLocaleMessages(initialAppLocale()).catch(() => undefined).then(render);

function render() {
  createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      {/* Navigation commits at once. In a transition (the router's default) a
          tap on a page whose code was still arriving kept the previous page and
          its highlight on screen, so the sidebar seemed not to respond. A page
          not loaded yet now shows its own skeleton instead. */}
      <HashRouter useTransitions={false}>
        <I18nProvider>
          <PwaLifecycleProvider>
            <RouteMetadataSync />
            <App />
            <PwaUpdatePrompt />
          </PwaLifecycleProvider>
        </I18nProvider>
      </HashRouter>
    </React.StrictMode>
  );
}
