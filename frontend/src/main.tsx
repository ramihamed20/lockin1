import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./app/App";
import { AuthProvider } from "./features/auth/AuthProvider";
import { I18nProvider } from "./i18n/I18nProvider";
import { initializePwa } from "./pwa/update";
import "./styles.css";
import "./legacy/legacy.css";

initializePwa();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Lock-in root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>
);
