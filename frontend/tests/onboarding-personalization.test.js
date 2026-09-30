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

test("appearance choices size their column from the tile, not from what they hold", async () => {
  // Every button carries the interaction primitive's justify-content: center.
  // A choice tile that switched to a grid without its own column was only as
  // wide as its content: "No mascot" drew at half size, and a picture could set
  // the column from its 640px intrinsic width and spill over its neighbours.
  const styles = await readFile(projectFile("src/styles/v2.css"), "utf8");
  for (const selector of [".settings-v2-choice", ".settings-v2-icon-option"]) {
    const block = styles.match(new RegExp(`\n${selector.replace(".", "\.")} \{([^}]*)\}`))?.[1] || "";
    assert.match(block, /grid-template-columns: minmax\(0, 1fr\);/, `${selector} needs an explicit column`);
    assert.match(block, /justify-content: stretch;/, `${selector} must not inherit centred content`);
  }
});
