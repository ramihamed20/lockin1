import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { catalogs } from "./catalogs";
import { I18nProvider, useI18n } from "./I18nProvider";

function LanguageProbe() {
  const { locale, direction, t, toggleLocale } = useI18n();
  return <button type="button" onClick={toggleLocale}>{locale}:{direction}:{t("login")}</button>;
}

describe("localization foundation", () => {
  it("keeps Arabic and English catalogs structurally identical", () => {
    expect(Object.keys(catalogs.ar).sort()).toEqual(Object.keys(catalogs.en).sort());
  });

  it("persists a validated locale and updates document direction", () => {
    localStorage.setItem("lockin.locale", "en");
    render(<I18nProvider><LanguageProbe /></I18nProvider>);
    expect(screen.getByRole("button", { name: "en:ltr:Log in" })).toBeVisible();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button", { name: "ar:rtl:تسجيل الدخول" })).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(localStorage.getItem("lockin.locale")).toBe("ar");
  });

  it("ignores an invalid stored locale", () => {
    localStorage.setItem("lockin.locale", "unsafe-value");
    render(<I18nProvider><LanguageProbe /></I18nProvider>);
    expect(screen.getByRole("button").textContent).toMatch(/^(en:ltr|ar:rtl):/);
  });
});
