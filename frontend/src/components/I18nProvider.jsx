import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { currentAppLocale, directionForLocale, loadLocaleMessages, normalizeLocale, translate } from "../lib/i18n.js";

const I18nContext = createContext(null);

/** The language the app opens in: the reader's last choice, else the document's. */
export function initialAppLocale() {
  try {
    const stored = window.localStorage.getItem("lock-in.locale");
    if (stored) return normalizeLocale(stored);
  } catch { /* Storage can be unavailable in hardened/private contexts. */ }
  return currentAppLocale();
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(initialAppLocale);

  // A production build holds one language at a time, so switch only once the
  // other one has arrived; a page never renders its keys in place of words.
  // If it cannot arrive (offline before it was ever cached), stay as we are.
  // Only the latest choice applies, however the downloads finish.
  const requestedLocale = useRef(null);
  const setLocale = useCallback((value) => {
    const next = normalizeLocale(value);
    requestedLocale.current = next;
    loadLocaleMessages(next).then(() => {
      if (requestedLocale.current === next) setLocaleState(next);
    }, () => undefined);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = directionForLocale(locale);
    // Chrome on Android offers to translate a page whose language is not the
    // reader's, and accepting it re-translates Arabic that is already Arabic --
    // machine prose over hand-written copy, with the layout it breaks. Marking
    // the document `translate="no"` (with the class Google's widget also reads)
    // declines that for the Arabic build only: the English build keeps the
    // offer, which is useful to a reader who wants it.
    const declineTranslation = directionForLocale(locale) === "rtl";
    root.translate = !declineTranslation;
    root.classList.toggle("notranslate", declineTranslation);
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
