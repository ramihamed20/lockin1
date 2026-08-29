import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { currentAppLocale, directionForLocale, normalizeLocale, translate } from "../lib/i18n.js";

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    try {
      const stored = window.localStorage.getItem("lock-in.locale");
      if (stored) return normalizeLocale(stored);
    } catch { /* Storage can be unavailable in hardened/private contexts. */ }
    return currentAppLocale();
  });

  const setLocale = useCallback((value) => setLocaleState(normalizeLocale(value)), []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionForLocale(locale);
    try {
      window.localStorage.setItem("lock-in.locale", locale);
    } catch { /* The document attributes still provide the correct experience. */ }
  }, [locale]);

  const value = useMemo(() => ({
    locale,
    direction: directionForLocale(locale),
    setLocale,
    t: (key, variables) => translate(locale, key, variables)
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider.");
  return context;
}
