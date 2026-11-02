import { useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ownerStorageKey } from "../storage/workspaceSnapshot.js";
import { FocusVideoPlayer } from "./FocusVideoPlayer.jsx";
import { WorkspacePaneActiveContext, WorkspacePaneVisibleContext, WorkspaceSplitContext } from "./workspacePane.js";
import { personalTabId, sheetTabId, useWorkspaceTabs, whiteboardTabId, workspaceTabRoute } from "./workspaceTabs.js";
import "./workspace-split.css";

/** Maximum number of background PDF readers retained besides visible panes. */
export const KEPT_WORKSPACE_PANES = 4;

/** @type {{ pattern: RegExp, toId: (parts: string[]) => string }[]} */
const PATTERNS = [
  { pattern: /^\/whiteboards\/([^/]+)\/workspace$/, toId: ([boardId]) => whiteboardTabId(boardId) },
  { pattern: /^\/materials\/catalog\/([^/]+)\/mine\/([^/]+)\/workspace$/, toId: ([, sheetId]) => personalTabId(sheetId) },
  { pattern: /^\/materials\/catalog\/([^/]+)\/sheets\/([^/]+)\/workspace$/, toId: ([materialSlug, sheetSlug]) => sheetTabId(materialSlug, sheetSlug) }
];

/** The workspace tab a reader address belongs to, or "" for a Sheet Summary. */
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

const clampPercent = (value) => Math.max(28, Math.min(72, value));

/**
 * Retains isolated PDF readers as tabs and, optionally, renders two together.
 * The focused pane receives global shortcuts; either visible pane may be
 * touched, drawn on, scrolled and zoomed without changing the other's state.
 */
export function WorkspaceKeepAlive({ user = null, Workspace }) {
  const location = useLocation();
  const navigate = useNavigate();
  const ownerKey = useMemo(() => ownerStorageKey(user), [user]);
  const [tabs] = useWorkspaceTabs(ownerKey);
  const [splitId, setSplitId] = useState("");
  const [splitPercent, setSplitPercent] = useState(50);
  const [secondarySide, setSecondarySide] = useState("end");
  const [focusedPath, setFocusedPath] = useState(location.pathname);
  const previousPrimaryPath = useRef(location.pathname);
  const layoutRef = useRef(null);
  /** @type {import("react").MutableRefObject<Map<string, { location: any, seen: number }>>} */
  const panesRef = useRef(new Map());
  const clockRef = useRef(0);

  const primaryId = workspaceTabIdForPath(location.pathname);
  // If a student selects the second reader as the main route, exchange the
  // two instead of showing the same PDF twice.
  useEffect(() => {
    const previous = previousPrimaryPath.current;
    if (splitId && primaryId === splitId && previous !== location.pathname) {
      const previousId = workspaceTabIdForPath(previous);
      setSplitId(previousId && previousId !== primaryId ? previousId : "");
    }
    previousPrimaryPath.current = location.pathname;
    setFocusedPath(location.pathname);
  }, [location.pathname, primaryId, splitId]);

  useEffect(() => {
    if (splitId && !tabs.tabs.some((tab) => tab.id === splitId)) setSplitId("");
  }, [splitId, tabs.tabs]);

  const splitTab = tabs.tabs.find((tab) => tab.id === splitId && tab.id !== primaryId);
  const splitPath = splitTab ? workspaceTabRoute(splitTab) : "";
  const visiblePaths = new Set([location.pathname, ...(splitPath ? [splitPath] : [])]);
  const openTabIds = new Set(tabs.tabs.map((tab) => tab.id));
  const panes = panesRef.current;
  clockRef.current += 1;
  panes.set(location.pathname, { location, seen: clockRef.current });
  if (splitPath && !panes.has(splitPath)) {
    // A tab which has not yet been selected can still be opened beside the
    // current one. It starts in Normal Study, without changing the main URL.
    panes.set(splitPath, {
      location: { ...location, pathname: splitPath, search: "", state: { studyMode: "normal" }, key: `split-${splitId}` },
      seen: clockRef.current
    });
  }
  for (const [path] of panes) {
    if (!visiblePaths.has(path) && !openTabIds.has(workspaceTabIdForPath(path))) panes.delete(path);
  }
  const kept = [...panes.entries()]
    .filter(([path]) => !visiblePaths.has(path))
    .sort((a, b) => b[1].seen - a[1].seen);
  kept.slice(KEPT_WORKSPACE_PANES).forEach(([path]) => panes.delete(path));

  function dropSplit(tabId, side) {
    if (!tabs.tabs.some((tab) => tab.id === tabId) || tabs.tabs.length < 2) return;
    setSplitPercent(50);
    setSecondarySide(side === "start" ? "start" : "end");
    if (tabId === primaryId) {
      // The currently selected sheet may be dragged too. Leave its nearest
      // already-open neighbour in the main pane and dock this sheet beside it.
      const index = tabs.tabs.findIndex((tab) => tab.id === tabId);
      const anchor = tabs.tabs[index + 1] || tabs.tabs[index - 1];
      if (!anchor) return;
      const anchorPath = workspaceTabRoute(anchor);
      setSplitId(tabId);
      setFocusedPath(anchorPath);
      navigate(anchorPath, { state: { studyMode: anchor.mode || "normal" } });
    } else {
      setSplitId(tabId);
      setFocusedPath(location.pathname);
    }
  }

  function resizeFromPointer(event) {
    const rect = layoutRef.current?.getBoundingClientRect();
    if (!rect) return;
    const stacked = window.matchMedia("(max-width: 640px)").matches;
    const offset = stacked ? event.clientY - rect.top : event.clientX - rect.left;
    const size = stacked ? rect.height : rect.width;
    if (size > 0) setSplitPercent(clampPercent((secondarySide === "start" ? 100 - offset * 100 / size : offset * 100 / size)));
  }

  const entries = [...panes.entries()].sort(([a], [b]) => {
    const order = (path) => path === location.pathname ? 0 : path === splitPath ? 1 : 2;
    return order(a) - order(b);
  });
  const paneNodes = entries.map(([path, pane]) => {
    const active = path === location.pathname;
    const visible = visiblePaths.has(path);
    const focused = visible && (focusedPath === path || (!visiblePaths.has(focusedPath) && active));
    return (
      <div
        key={path}
        className={active ? "workspace-pane is-active" : visible ? "workspace-pane is-secondary" : "workspace-pane is-kept"}
        aria-hidden={visible ? undefined : "true"}
        inert={visible ? undefined : ""}
        onPointerDownCapture={() => { if (visible && !focused) setFocusedPath(path); }}
      >
        <WorkspacePaneVisibleContext.Provider value={visible}>
          <WorkspacePaneActiveContext.Provider value={focused}>
          <Routes location={active ? location : pane.location}>
            <Route path="/materials/catalog/:materialSlug/mine/:sheetId/workspace" element={<Workspace user={user} variant="personal" />} />
            <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug/summary" element={<Workspace user={user} variant="summary" />} />
            <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug/workspace" element={<Workspace user={user} />} />
            <Route path="/whiteboards/:boardId/workspace" element={<Workspace user={user} variant="whiteboard" />} />
          </Routes>
          </WorkspacePaneActiveContext.Provider>
        </WorkspacePaneVisibleContext.Provider>
      </div>
    );
  });

  const readers = <WorkspaceSplitContext.Provider value={{ splitId: splitPath ? splitId : "", dropSplit, closeSplit: () => setSplitId("") }}>
    <div className={`workspace-split-layout${splitPath ? " is-split" : ""}`} data-secondary-side={secondarySide} ref={layoutRef} style={splitPath ? { "--workspace-split-primary": `${splitPercent}%` } : undefined}>
      {paneNodes}
      {splitPath && <div
        role="separator"
        className="workspace-split-divider"
        aria-label="Resize PDF split"
        aria-orientation={typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? "horizontal" : "vertical"}
        aria-valuemin={28}
        aria-valuemax={72}
        aria-valuenow={Math.round(splitPercent)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.target.closest("button")) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeFromPointer(event);
        }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeFromPointer(event); }}
        onKeyDown={(event) => {
          const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 5 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -5 : 0;
          if (!delta) return;
          event.preventDefault();
          setSplitPercent((size) => clampPercent(size + delta));
        }}
      >
        <span className="workspace-split-grip" aria-hidden="true" />
        <button type="button" className="workspace-split-close" onClick={() => setSplitId("")} aria-label="Close split view" title="Close split view">×</button>
      </div>}
    </div>
  </WorkspaceSplitContext.Provider>;
  // The player remains outside both readers, so it does not restart on resize.
  return <>{readers}<FocusVideoPlayer /></>;
}
