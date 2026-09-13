import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { defaultThemeSettings } from "../src/lib/constants.js";
import { normalizeThemeSettings } from "../src/lib/utils.js";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

test("visual preferences keep mascot visibility independent from the selected theme", () => {
  assert.deepEqual(normalizeThemeSettings({ character: "none", theme: "sunset", autoTheme: true }), {
    character: "none",
    theme: "sunset",
    autoTheme: true,
    appIcon: defaultThemeSettings.appIcon
  });
  assert.equal(normalizeThemeSettings({ character: "black", theme: "day" }).theme, "day");
  assert.equal(normalizeThemeSettings({ character: "unknown", theme: "unknown" }).character, "white");
});

test("welcome onboarding uses shared profile preferences without rendering mascot artwork", async () => {
  const [welcome, accounts, app, settings] = await Promise.all([
    readFile(projectFile("src/pages/WelcomeOnboarding.jsx"), "utf8"),
    readFile(projectFile("src/api/accounts.js"), "utf8"),
    readFile(projectFile("src/App.jsx"), "utf8"),
    readFile(projectFile("src/pages/Settings.jsx"), "utf8")
  ]);

  assert.match(welcome, /chooseLanguage/);
  assert.match(welcome, /mascotPreference: preferences\.settings\.character/);
  assert.match(welcome, /dynamicTheme: preferences\.settings\.autoTheme/);
  assert.match(welcome, /onThemeSettingsChange\?\.\(settings\)/);
  assert.match(welcome, /welcome-theme-options/);
  assert.doesNotMatch(welcome, /mascot-study/);
  assert.doesNotMatch(welcome, /ResponsiveThemePreview/);
  assert.match(accounts, /mascot_preference/);
  assert.match(accounts, /theme_preference/);
  assert.match(accounts, /dynamic_theme/);
  assert.match(app, /<WelcomeOnboarding user=\{user\} onUserUpdate=\{setUser\} onThemeSettingsChange=\{updateThemeSettings\}/);
  assert.match(settings, /accountsApi\.updateProfile\(/);
});

test("none mascot preview does not request an imaginary mascot asset", async () => {
  const preview = await readFile(projectFile("src/components/shared/ResponsiveThemePreview.jsx"), "utf8");

  assert.match(preview, /character === "none"/);
  assert.match(preview, /theme-preview-empty/);
  assert.doesNotMatch(preview, /none-\$\{theme\}/);
});
