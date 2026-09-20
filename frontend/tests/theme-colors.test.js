import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const stylesPath = fileURLToPath(new URL("../src/styles.css", import.meta.url));
const appPath = fileURLToPath(new URL("../src/App.jsx", import.meta.url));
const focusPath = fileURLToPath(new URL("../src/pages/catalog-focus-workspace.css", import.meta.url));
const lockInPath = fileURLToPath(new URL("../src/pages/lock-in-reference.css", import.meta.url));
const tokensPath = fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url));
const styles = readFileSync(stylesPath, "utf8");
const tokenStyles = readFileSync(tokensPath, "utf8");

function selectorBlock(source, selectorPattern) {
  const match = source.match(new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  assert.ok(match, `Missing selector: ${selectorPattern}`);
  return match[1];
}

function tokenMap(block) {
  return Object.fromEntries(
    [...block.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((match) => [match[1], match[2].trim()])
  );
}

const palettes = {
  day: {
    bg: "#F4F5F7", surface: "#FBFCFD", text: "#191A22", secondary: "#4B4F5C", muted: "#626776",
    accent: "#5B4CC4", accentSubtle: "#EEECFA", accentText: "#463A9A", success: "#287A55",
    warning: "#8A5B12", danger: "#B74444", info: "#286AA6"
  },
  dawn: {
    bg: "#F3F1EC", surface: "#FCFBF8", text: "#242821", secondary: "#51574D", muted: "#656C62",
    accent: "#2F6F69", accentSubtle: "#E2EFEC", accentText: "#245B56", success: "#347A50",
    warning: "#8D611C", danger: "#AD4B49", info: "#3C6E91"
  },
  sunset: {
    bg: "#F3ECEA", surface: "#FBF8F6", text: "#2F232E", secondary: "#5D4B59", muted: "#71606C",
    accent: "#7B3F6D", accentSubtle: "#F1E3EC", accentText: "#68345D", success: "#3D7756",
    warning: "#92601B", danger: "#AD4A50", info: "#4F6E91"
  }
};

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex) {
  return rgb(hex)
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

test("design tokens are the single source for the Night palette", () => {
  const root = tokenMap(selectorBlock(tokenStyles, ":root"));
  assert.equal(root["--bg"], "#090c14");
  assert.equal(root["--surface"], "#0f131c");
  assert.equal(root["--text"], "#edf0f6");
  assert.equal(root["--accent"], "#f1c04f");
  assert.equal(root["--danger"], "#f27272");
  assert.doesNotMatch(styles, /\s--(?:bg|surface|text|accent|gold|primary):/);
  assert.doesNotMatch(styles, /\/\* Premium UI refresh layer \*\//);
});

test("light themes share neutrals and keep one deliberate accent each", () => {
  const shared = tokenMap(selectorBlock(tokenStyles, ':root:is\\(\\[data-theme="day"\\], \\[data-theme="light"\\], \\[data-theme="dawn"\\], \\[data-theme="sunset"\\]\\)'));
  const day = tokenMap(selectorBlock(tokenStyles, ':root:is\\(\\[data-theme="day"\\], \\[data-theme="light"\\]\\)'));
  const dawn = tokenMap(selectorBlock(tokenStyles, ':root\\[data-theme="dawn"\\]'));
  const sunset = tokenMap(selectorBlock(tokenStyles, ':root\\[data-theme="sunset"\\]'));

  assert.equal(shared["--surface"], "#ffffff");
  assert.equal(shared["--text"], "#141821");
  assert.equal(shared["--danger"], "#c73b3b");
  assert.equal(shared["--workspace-stage"], "#e8eaef");
  assert.equal(day["--accent"], "#5b4bd6");
  assert.equal(dawn["--accent"], "#1f7a78");
  assert.equal(sunset["--accent"], "#a8356f");
  assert.equal(dawn["--on-accent"], "#ffffff");
  assert.equal(sunset["--on-accent"], "#ffffff");
});

test("light text, accent, selection, and semantic combinations meet WCAG AA", () => {
  for (const [theme, palette] of Object.entries(palettes)) {
    assert.ok(contrast(palette.text, palette.bg) >= 4.5, `${theme} primary text`);
    assert.ok(contrast(palette.secondary, palette.bg) >= 4.5, `${theme} secondary text`);
    assert.ok(contrast(palette.muted, palette.bg) >= 4.5, `${theme} muted/placeholder text`);
    assert.ok(contrast("#FFFFFF", palette.accent) >= 4.5, `${theme} text on accent`);
    assert.ok(contrast(palette.accentText, palette.accentSubtle) >= 4.5, `${theme} selected navigation`);
    for (const role of ["success", "warning", "danger", "info"]) {
      assert.ok(contrast(palette[role], palette.surface) >= 4.5, `${theme} ${role}`);
    }
  }
});

test("obsolete Dawn and Sunset palette literals do not survive in responsive theme rules", () => {
  const themedRules = [...styles.matchAll(/([^{}]*:root\[data-theme="(?:dawn|sunset)"\][^{}]*)\{([^{}]*)\}/g)]
    .map((match) => `${match[1]}{${match[2]}}`)
    .join("\n")
    .toLowerCase();
  for (const obsolete of ["#6fa8ff", "#8bc5ff", "#c8b6ff", "#5c93e6", "#7cb8ff", "#bfaaff", "#f472b6", "#fb7185", "#ff9e7a", "#fdba74", "rgba(111, 168, 255", "rgba(244, 114, 182"]) {
    assert.equal(themedRules.includes(obsolete), false, obsolete);
  }
});

test("PWA chrome and immersive workspaces expose only light-theme overrides", () => {
  const app = readFileSync(appPath, "utf8");
  const focus = readFileSync(focusPath, "utf8");
  const lockIn = readFileSync(lockInPath, "utf8");
  for (const [theme, color] of [["day", "#F4F5F7"], ["dawn", "#F3F1EC"], ["sunset", "#F3ECEA"], ["night", "#070B16"]]) {
    assert.match(app, new RegExp(`${theme}:\\s*"${color}"`));
  }
  assert.match(app, /meta\[name="theme-color"\]/);
  assert.doesNotMatch(focus, /data-theme="night"/);
  assert.doesNotMatch(lockIn, /data-theme="night"/);
  assert.match(focus, /--workspace-stage-bg:\s*oklch\(90\.5% 0\.008 264\.5\)/);
  assert.match(focus, /--workspace-stage-bg:\s*oklch\(87\.9% 0\.008 91\.5\)/);
  assert.match(focus, /--workspace-stage-bg:\s*oklch\(86\.9% 0\.015 17\.4\)/);
});
