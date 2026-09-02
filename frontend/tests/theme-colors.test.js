import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const stylesPath = fileURLToPath(new URL("../src/styles.css", import.meta.url));
const appPath = fileURLToPath(new URL("../src/App.jsx", import.meta.url));
const focusPath = fileURLToPath(new URL("../src/pages/catalog-focus-workspace.css", import.meta.url));
const lockInPath = fileURLToPath(new URL("../src/pages/lock-in-reference.css", import.meta.url));
const styles = readFileSync(stylesPath, "utf8");

function normalizedHash(value) {
  return createHash("sha256").update(value.replaceAll("\r\n", "\n")).digest("hex");
}

function blockAfterMarker(marker, selectorPattern) {
  const markerIndex = styles.indexOf(marker);
  assert.notEqual(markerIndex, -1, `Missing marker: ${marker}`);
  const match = styles.slice(markerIndex).match(new RegExp(`${selectorPattern}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Missing selector after ${marker}: ${selectorPattern}`);
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

const expectedCss = {
  day: {
    "--bg": "oklch(97% 0.003 264.5)", "--bg-2": "oklch(94.9% 0.006 264.5)", "--surface": "oklch(99.1% 0.002 247.8)",
    "--surface-2": "oklch(96.6% 0.005 258.3)", "--surface-elevated": "oklch(100% 0 89.9)", "--text": "oklch(22% 0.016 279.4)",
    "--muted": "oklch(42.9% 0.022 271.9)", "--soft": "oklch(51.5% 0.024 270.9)", "--disabled-text": "oklch(63.4% 0.022 270.1)",
    "--border": "oklch(89.4% 0.012 264.5)", "--border-subtle": "oklch(93.3% 0.009 264.5)", "--accent": "oklch(50.1% 0.18 283.5)",
    "--accent-hover": "oklch(45.5% 0.167 283.4)", "--accent-active": "oklch(40.7% 0.146 284.2)", "--accent-subtle": "oklch(94.9% 0.019 292.6)",
    "--accent-border": "oklch(83.6% 0.06 291.4)", "--accent-text": "oklch(41.9% 0.15 283.5)", "--green": "oklch(52% 0.099 160.1)",
    "--highlight": "oklch(51.1% 0.102 71.8)", "--danger": "oklch(54.5% 0.15 23.5)", "--color-info": "oklch(51.2% 0.116 249.4)"
  },
  dawn: {
    "--bg": "oklch(95.8% 0.007 88.6)", "--bg-2": "oklch(92.8% 0.01 93.6)", "--surface": "oklch(98.8% 0.004 91.4)",
    "--surface-2": "oklch(94.9% 0.008 91.5)", "--surface-elevated": "oklch(99.4% 0.006 84.6)", "--text": "oklch(27% 0.014 131.7)",
    "--muted": "oklch(44.8% 0.018 132.7)", "--soft": "oklch(52.2% 0.018 136.1)", "--disabled-text": "oklch(63.1% 0.017 136.1)",
    "--border": "oklch(87.2% 0.011 95.2)", "--border-subtle": "oklch(91.3% 0.008 91.5)", "--accent": "oklch(49.8% 0.066 187)",
    "--accent-hover": "oklch(44.7% 0.059 187.3)", "--accent-active": "oklch(39.4% 0.051 187.7)", "--accent-subtle": "oklch(94.2% 0.014 180.7)",
    "--accent-border": "oklch(85.3% 0.032 181.7)", "--accent-text": "oklch(43.3% 0.058 187.1)", "--green": "oklch(52.3% 0.097 154.7)",
    "--highlight": "oklch(52.7% 0.1 73.8)", "--danger": "oklch(53.9% 0.129 23.6)", "--color-info": "oklch(51.8% 0.078 241)"
  },
  sunset: {
    "--bg": "oklch(94.8% 0.008 36.6)", "--bg-2": "oklch(90.8% 0.012 37.4)", "--surface": "oklch(98.1% 0.004 56.4)",
    "--surface-2": "oklch(93.9% 0.01 41.9)", "--surface-elevated": "oklch(99.5% 0.003 48.7)", "--text": "oklch(27.5% 0.026 329)",
    "--muted": "oklch(43.6% 0.033 333.9)", "--soft": "oklch(51% 0.028 336.6)", "--disabled-text": "oklch(62.3% 0.023 338)",
    "--border": "oklch(85.9% 0.014 17.4)", "--border-subtle": "oklch(91% 0.01 25.1)", "--accent": "oklch(45.9% 0.103 336.6)",
    "--accent-hover": "oklch(40.7% 0.093 335.7)", "--accent-active": "oklch(35.9% 0.08 335.5)", "--accent-subtle": "oklch(93% 0.019 338.7)",
    "--accent-border": "oklch(80.6% 0.049 339.3)", "--accent-text": "oklch(40.7% 0.093 335.7)", "--green": "oklch(52% 0.081 157.1)",
    "--highlight": "oklch(53.1% 0.104 69.8)", "--danger": "oklch(54% 0.13 18.8)", "--color-info": "oklch(52.9% 0.066 252.1)"
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

test("Night root layers remain byte-stable after newline normalization", () => {
  // styles.css is wrapped in `@layer app { … }`, so the first :root block no
  // longer starts at byte zero. Its contents are unchanged, which is what the
  // hashes below pin.
  const initialRoot = styles.match(/^:root\s*\{[\s\S]*?\n\}/m)?.[0];
  const premiumRoot = styles.slice(styles.indexOf("/* Premium UI refresh layer */")).match(/:root\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(initialRoot);
  assert.ok(premiumRoot);
  assert.equal(normalizedHash(initialRoot), "b98bf03bfb57d3199cff7482c910200afff57c9f95cb62d391478dc7dbcfa3bb");
  assert.equal(normalizedHash(premiumRoot), "3144102caf84efa76d3a32bf1566a7c489bd40313a1cc0437b442fa8710f1e3f");
  assert.doesNotMatch(styles, /:root\[data-theme="night"\][^{]*\{[^}]*--/s);
});

test("the final light blocks provide the required OKLCH color contracts", () => {
  const marker = "/* Premium UI refresh layer */";
  const blocks = {
    day: blockAfterMarker(marker, ':root\\[data-theme="light"\\],\\s*:root\\[data-theme="day"\\]'),
    dawn: blockAfterMarker(marker, ':root\\[data-theme="dawn"\\]'),
    sunset: blockAfterMarker(marker, ':root\\[data-theme="sunset"\\]')
  };
  for (const [theme, expected] of Object.entries(expectedCss)) {
    const tokens = tokenMap(blocks[theme]);
    for (const [token, value] of Object.entries(expected)) assert.equal(tokens[token], value, `${theme} ${token}`);
    for (const token of ["--text-placeholder", "--interactive-hover", "--interactive-selected", "--overlay", "--shadow-color", "--skeleton-base", "--scrollbar-thumb", "--data-series-1", "--workspace-stage"]) {
      assert.ok(tokens[token], `${theme} is missing ${token}`);
    }
  }
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
