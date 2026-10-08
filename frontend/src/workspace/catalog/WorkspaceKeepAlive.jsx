import { useMemo, useRef } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { ownerStorageKey } from "../storage/workspaceSnapshot.js";
import { WorkspacePaneActiveContext } from "./workspacePane.js";
import { personalTabId, sheetTabId, useWorkspaceTabs, whiteboardTabId } from "./workspaceTabs.js";

/** How many readers stay mounted besides the one on screen. Each holds a PDF and its page canvases. */
export const KEPT_WORKSPACE_PANES = 4;

/** @type {{ pattern: RegExp, toId: (parts: string[]) => string }[]} */
const PATTERNS = [
  { pattern: /^\/whiteboards\/([^/]+)\/workspace$/, toId: ([boardId]) => whiteboardTabId(boardId) },
  { pattern: /^\/materials\/catalog\/([^/]+)\/mine\/([^/]+)\/workspace$/, toId: ([, sheetId]) => personalTabId(sheetId) },
  { pattern: /^\/materials\/catalog\/([^/]+)\/sheets\/([^/]+)\/workspace$/, toId: ([materialSlug, sheetSlug]) => sheetTabId(materialSlug, sheetSlug) }
];

/** The workspace tab a reader address belongs to, or "" for one that is not a tab (a Sheet Summary). */
export function workspaceTabIdForPath(pathname) {
  for (const { pattern, toId } of PATTERNS) {
    const match = pattern.exec(pathname);
    if (match) {
      try {
        return toId(match.slice(1).map(decodeURIComponent));
      } catch {
        return "";
      }
    }
  }
  return "";
}

/**
 * Keeps the readers of open tabs mounted while another tab is on screen.
 *
 * Each tab is still its own address, so a link, a reload or the back button
 * opens exactly that document. What changes is that leaving a tab no longer
 * unmounts its reader: the PDF, the page it was on, its zoom, tool and Active
 * Study state all stay as they were, and coming back is instant instead of a
 * fresh load. Every kept reader renders against the address it was opened at
 * (`<Routes location>`), so its route parameters never follow the tab on
 * screen. Hidden readers stay laid out at full size (`visibility: hidden`), so
 * nothing in them measures a zero-sized viewport while they wait.
 */
export function WorkspaceKeepAlive({ user = null, Workspace }) {
  const location = useLocation();
  const ownerKey = useMemo(() => ownerStorageKey(user), [user]);
  const [tabs] = useWorkspaceTabs(ownerKey);
  /** @type {import("react").MutableRefObject<Map<string, { location: any, seen: number }>>} */
  const panesRef = useRef(new Map());
  const clockRef = useRef(0);

  const openTabIds = new Set(tabs.tabs.map((tab) => tab.id));
  const panes = panesRef.current;
  clockRef.current += 1;
  panes.set(location.pathname, { location, seen: clockRef.current });
  for (const [path] of panes) {
    // A closed tab, or a document that is not a tab at all, is not kept.
    if (path !== location.pathname && !openTabIds.has(workspaceTabIdForPath(path))) panes.delete(path);
  }
  const hidden = [...panes.entries()].filter(([path]) => path !== location.pathname).sort((a, b) => b[1].seen - a[1].seen);
  hidden.slice(KEPT_WORKSPACE_PANES).forEach(([path]) => panes.delete(path));

  return [...panes.entries()].map(([path, pane]) => {
    const active = path === location.pathname;
    return (
      <div
        key={path}
        className={active ? "workspace-pane is-active" : "workspace-pane is-kept"}
        aria-hidden={active ? undefined : "true"}
        // React 18 has no boolean `inert` prop; the attribute alone is enough.
        inert={active ? undefined : ""}
      >
        <WorkspacePaneActiveContext.Provider value={active}>
          <Routes location={active ? location : pane.location}>
            <Route path="/materials/catalog/:materialSlug/mine/:sheetId/workspace" element={<Workspace user={user} variant="personal" />} />
            <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug/summary" element={<Workspace user={user} variant="summary" />} />
            <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug/workspace" element={<Workspace user={user} />} />
            <Route path="/whiteboards/:boardId/workspace" element={<Workspace user={user} variant="whiteboard" />} />
          </Routes>
        </WorkspacePaneActiveContext.Provider>
      </div>
    );
  });
}
