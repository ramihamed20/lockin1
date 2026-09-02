// Layer order must be declared before any stylesheet reaches the document: a
// layer's position is fixed the first time it is named, so a component
// stylesheet pulled in through App.jsx would otherwise register `app` first
// and leave `primitives` ranked above it. Keep these imports at the top.
import "./styles/layers.css";
import "./styles.css";
import "./responsive.css";
import "./launch-readiness.css";
// Declared last: the interaction layer owns hover, press, focus and selection
// for the whole application, and layers — not import order — decide the winner
// even though route stylesheets load lazily.
import "./styles/interaction.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { I18nProvider } from "./components/I18nProvider.jsx";
import { RouteMetadataSync } from "./components/RouteMetadataSync.jsx";
import { PwaUpdatePrompt } from "./components/shared/PwaUpdatePrompt.jsx";
import { PwaLifecycleProvider } from "./pwa/PwaLifecycleProvider.jsx";
import { installInteractionRuntime } from "./lib/interaction.js";
import { installViewportSync } from "./lib/viewport.js";
import { installClientErrorReporting } from "./lib/clientErrorReporting.js";

installInteractionRuntime();
// Installed before the first render so the keyboard token already has a value
// on the first painted frame. The application's height is owned by CSS, so the
// layout is never waiting on this.
installViewportSync();
installClientErrorReporting();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
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
