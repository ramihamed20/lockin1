import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App.jsx";
import { I18nProvider } from "./components/I18nProvider.jsx";
import { RouteMetadataSync } from "./components/RouteMetadataSync.jsx";
import { PwaUpdatePrompt } from "./components/shared/PwaUpdatePrompt.jsx";
import { PwaLifecycleProvider } from "./pwa/PwaLifecycleProvider.jsx";
import "./styles.css";
import "./responsive.css";
import "./launch-readiness.css";

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
