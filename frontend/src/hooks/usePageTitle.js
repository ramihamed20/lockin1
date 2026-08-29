import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useI18n } from "../components/I18nProvider.jsx";
import { routeMetadata } from "../lib/routeMetadata.js";

export function usePageTitle(title = "") {
  const location = useLocation();
  const { t, locale } = useI18n();
  useEffect(() => {
    const metadata = routeMetadata(location.pathname, t);
    document.title = title && title !== metadata.h1 ? `${title} | Lock-in` : metadata.documentTitle;
  }, [location.pathname, locale, t, title]);
}
