import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { initializePwa } from "./pwa/update";
import "./styles.css";

initializePwa();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Lock-in root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
