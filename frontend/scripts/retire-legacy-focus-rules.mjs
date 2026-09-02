/**
 * One-time codemod that deletes the competing focus systems.
 *
 * Before this ran the application drew a keyboard-focus indicator from at
 * least four independent places — a global `*:focus-visible`, a global
 * `button, input, a:focus-visible`, a `.btn/.icon-btn` box-shadow ring, and a
 * long tail of per-component outlines — several of which fired at once and
 * all of which used the brand accent, the same colour as "selected". Other
 * rules had `:focus-visible` grouped with `:hover`, so keyboard focus
 * inherited hover's background and read as a selection.
 *
 * Focus is now defined once, in src/styles/interaction.css, on the outline
 * channel only. This removes everything it replaces.
 *
 * Run with: node scripts/retire-legacy-focus-rules.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

/** @type {{ file: string, find: string, replace: string, note: string }[]} */
const EDITS = [
  {
    file: "src/styles.css",
    note: "global ring #1 (outline + box-shadow on every button/input/link)",
    find: `button:focus-visible,
input:focus-visible,
a:focus-visible {
  outline: 3px solid var(--color-ring);
  outline-offset: 3px;
  box-shadow: var(--shadow-focus);
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "global ring #2 (universal selector) and the .btn/.icon-btn shadow ring",
    find: `/* Enhanced focus visible for keyboard users */
*:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
  border-radius: var(--radius-sm);
}

.btn:focus-visible,
.icon-btn:focus-visible {
  box-shadow: var(--shadow-focus);
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "accent-coloured ring override on the primary button",
    find: `.btn-primary:focus-visible {
  outline-color: var(--color-focus-contrast);
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "light-theme ring recolour",
    find: `:root:is([data-theme="light"], [data-theme="day"], [data-theme="dawn"], [data-theme="sunset"]) :is(button, a, input, textarea, select, summary):focus-visible {
  outline-color: var(--focus);
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "toggle switch ring",
    find: `.auto-toggle:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 3px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "composer / progress tab rings",
    find: `.composer-controls button:focus-visible,
.progress-tabs button:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "dashboard recent material ring",
    find: `.dashboard-recent-material:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--color-primary) 52%, transparent);
  outline-offset: 2px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "stat card: parent focus-within frame plus child ring (double indicator)",
    find: `.dashboard-stats-grid .stat-card--interactive:focus-within {
  border-color: color-mix(in srgb, var(--focus) 70%, var(--border));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--focus) 58%, transparent);
}

.dashboard-stats-grid .stat-card-action:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -4px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "notification row ring",
    find: `.notification-item:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--notification-tone) 74%, transparent);
  outline-offset: -2px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "review queue ring",
    find: `.review-queue-link:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--review-queue-tone) 55%, transparent);
  outline-offset: 2px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "review row rings",
    find: `.review-subject-row:focus-visible,
.recent-mistake:focus-visible,
.review-choice:has(input:focus-visible) {
  outline: 3px solid var(--color-ring);
  outline-offset: 3px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "catalog tile ring",
    find: `.catalog-tile__surface:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--color-primary) 50%, transparent);
  outline-offset: -3px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "catalog sheet ring",
    find: `.catalog-sheet-card:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--color-primary) 50%, transparent);
  outline-offset: -3px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "app icon ring",
    find: `.app-icon-option:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

`,
    replace: ""
  },
  {
    file: "src/styles.css",
    note: "keyboard focus borrowing hover visuals — app icon",
    find: `.app-icon-option:hover,
.app-icon-option:focus-visible {`,
    replace: ".app-icon-option:hover {"
  },
  {
    file: "src/styles.css",
    note: "keyboard focus borrowing hover visuals — lasso actions",
    find: `.pdf-lasso-actions button:hover,
.pdf-lasso-actions button:focus-visible {`,
    replace: ".pdf-lasso-actions button:hover {"
  },
  {
    file: "src/styles.css",
    note: "keyboard focus borrowing hover visuals (and a scale) — plan row",
    find: `.plan-row button:hover:not(:disabled),
.plan-row button:focus-visible {`,
    replace: ".plan-row button:hover:not(:disabled) {"
  },
  {
    file: "src/styles.css",
    note: "keyboard focus borrowing hover visuals — notification row",
    find: `.notification-item:not(:disabled):hover,
.notification-item:not(:disabled):focus-visible {`,
    replace: ".notification-item:not(:disabled):hover {"
  },
  {
    file: "src/responsive.css",
    note: "calendar / heatmap: container focus painting a cell as selected",
    find: `.progress-calendar-table:focus-visible .progress-calendar-cell[aria-selected="true"],
.profile-heatmap:focus-visible .profile-heat-cell[aria-selected="true"],
.progress-calendar-cell[aria-selected="true"],`,
    replace: `.progress-calendar-cell[aria-selected="true"],`
  },
  {
    file: "src/responsive.css",
    note: "drawer rings",
    find: `  .drawer-profile-action:focus-visible,
  .drawer-navigation .nav-btn:focus-visible,
  .drawer-theme-options button:focus-visible,
  .drawer-close:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

`,
    replace: ""
  },
  {
    file: "src/responsive.css",
    note: "settings local nav: focus rendered identically to the current section",
    find: `  .settings-local-nav button:focus-visible,
  .settings-local-nav button:hover,`,
    replace: `  .settings-local-nav button:hover,`
  },
  {
    file: "src/responsive.css",
    note: "account menu rings",
    find: `.account-menu-actions a:focus-visible,
.account-menu-signout:focus-visible,
.avatar-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

`,
    replace: ""
  },
  {
    file: "src/pages/catalog-focus-workspace.css",
    note: "workspace ring",
    find: `.workspace-v2-icon-button:focus-visible, .workspace-v2 button:focus-visible, .workspace-v2 input:focus-visible, .workspace-v2 textarea:focus-visible, .workspace-v2 select:focus-visible { outline: 2px solid #a88cff; outline-offset: 2px; }
`,
    replace: ""
  },
  {
    file: "src/pages/catalog-focus-workspace.css",
    note: "workspace ring recolour for light themes",
    find: `:root:is([data-theme="light"], [data-theme="day"], [data-theme="dawn"], [data-theme="sunset"]) .workspace-v2 :is(.workspace-v2-icon-button, button, input, textarea, select):focus-visible {
  outline-color: var(--accent);
}

`,
    replace: ""
  }
];

const cache = new Map();
const missing = [];

for (const edit of EDITS) {
  const file = path.join(root, edit.file);
  if (!cache.has(file)) cache.set(file, await readFile(file, "utf8"));
  const source = cache.get(file);
  const occurrences = source.split(edit.find).length - 1;
  if (occurrences !== 1) {
    missing.push(`${edit.file}: expected 1 match for "${edit.note}", found ${occurrences}`);
    continue;
  }
  cache.set(file, source.replace(edit.find, edit.replace));
  process.stdout.write(`removed: ${edit.file} — ${edit.note}\n`);
}

if (missing.length) {
  process.stderr.write(`${missing.join("\n")}\n`);
  process.exit(1);
}

for (const [file, source] of cache) await writeFile(file, source, "utf8");
process.stdout.write(`done (${cache.size} files rewritten)\n`);
