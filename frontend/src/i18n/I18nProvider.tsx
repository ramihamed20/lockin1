import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";

import { catalogs, type Locale, type MessageKey } from "./catalogs";

type I18nValue = {
  locale: Locale;
  direction: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nValue | null>(null);
const LOCALE_KEY = "lockin.locale";

function initialLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_KEY);
  if (stored === "en" || stored === "ar") return stored;
  return navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    localStorage.setItem(LOCALE_KEY, locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      direction: locale === "ar" ? "rtl" : "ltr",
      setLocale,
      toggleLocale: () => setLocale((current) => (current === "en" ? "ar" : "en")),
      t: (key) => catalogs[locale][key]
    }),
    [locale]
  );

  return <I18nContext value={value}>{children}</I18nContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nValue {
  const value = use(I18nContext);
  if (!value) throw new Error("useI18n must be used inside I18nProvider.");
  return value;
}
