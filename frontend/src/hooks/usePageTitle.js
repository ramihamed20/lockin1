import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "../components/I18nProvider.jsx";
import { pageDocumentTitle } from "../lib/routeMetadata.js";
import { useWorkspacePaneActive } from "../workspace/catalog/workspacePane.js";

export function usePageTitle(title = "") {
  const location = useLocation();
  const { t, locale } = useI18n();
  // Only the reader on screen names the page; a tab kept behind it does not.
  const active = useWorkspacePaneActive();
  useEffect(() => {
    if (!active) return;
    document.title = pageDocumentTitle(title, location.pathname, t);
  }, [active, location.pathname, locale, t, title]);
}
