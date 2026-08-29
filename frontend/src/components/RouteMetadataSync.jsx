import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { routeMetadata } from "../lib/routeMetadata.js";
import { useI18n } from "./I18nProvider.jsx";

export function RouteMetadataSync() {
  const location = useLocation();
  const { t, locale } = useI18n();

  useEffect(() => {
    document.title = routeMetadata(location.pathname, t).documentTitle;
  }, [location.pathname, locale, t]);

  return null;
}
