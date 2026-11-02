/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- An ARIA grid pane may be selected by pointer; dividers accept arrows and pointer drag. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ownerStorageKey } from "../storage/workspaceSnapshot.js";
import { FocusVideoPlayer } from "./FocusVideoPlayer.jsx";
import { WorkspacePaneActiveContext, WorkspacePaneVisibleContext, WorkspaceSplitContext } from "./workspacePane.js";
import { personalTabId, sheetTabId, useWorkspaceTabs, whiteboardTabId, workspaceTabRoute } from "./workspaceTabs.js";
import { currentAppLocale } from "../../lib/i18n.js";
import "./workspace-split.css";

export const KEPT_WORKSPACE_PANES = 4;
export const MAX_VISIBLE_WORKSPACE_SHEETS = 4;
/** @type {{pattern:RegExp, toId:(parts:string[])=>string}[]} */
const PATTERNS = [
  { pattern: /^\/whiteboards\/([^/]+)\/workspace$/, toId: ([boardId]) => whiteboardTabId(boardId) },
  { pattern: /^\/materials\/catalog\/([^/]+)\/mine\/([^/]+)\/workspace$/, toId: ([, sheetId]) => personalTabId(sheetId) },
  { pattern: /^\/materials\/catalog\/([^/]+)\/sheets\/([^/]+)\/workspace$/, toId: ([materialSlug, sheetSlug]) => sheetTabId(materialSlug, sheetSlug) }
];

/** The selected tab id for a reader route, or "" outside a reader. */
export function workspaceTabIdForPath(pathname) {
  for (const { pattern, toId } of PATTERNS) {
    const match = pattern.exec(pathname);
    if (match) {
      try { return toId(match.slice(1).map(decodeURIComponent)); }
      catch { return ""; }
    }
  }
  return "";
}

const clampPercent = (number) => Math.max(28, Math.min(72, number));
/** Each array position is a grid slot (left, top-right, bottom-right, bottom-left). */
export function nextSplitSlots(slots, primaryId, addedId, side = "end") {
  if (!primaryId || !addedId) return slots;
  const old = slots.length ? slots : [primaryId];
  if (old.includes(addedId) || old.length >= MAX_VISIBLE_WORKSPACE_SHEETS) return old;
  if (old.length === 1 && side === "start") return [addedId, old[0]];
  if (old.length > 1 && side === "start") return [addedId, ...old];
  return [...old, addedId];
}

/** Never remount another PDF when the student focuses its pane. */
export function WorkspaceKeepAlive({ user = null, Workspace }) {
  const location = useLocation();
  const navigate = useNavigate();
  const ownerKey = useMemo(() => ownerStorageKey(user), [user]);
  const [tabs] = useWorkspaceTabs(ownerKey);
  const [slots, setSlots] = useState(/** @type {string[]} */ ([]));
  const [splitPercent, setSplitPercent] = useState(50);
  const [focusedPath, setFocusedPath] = useState(location.pathname);
  const [toolbarHost, setToolbarHost] = useState(/** @type {Element|null} */ (null));
  const previousPrimary = useRef(location.pathname);
  const layoutRef = useRef(null);
  /** @type {import("react").MutableRefObject<Map<string, {location: any, seen: number}>>} */
  const panesRef = useRef(new Map());
  const clockRef = useRef(0);

  const primaryId = workspaceTabIdForPath(location.pathname);
  const openIds = new Set(tabs.tabs.map((tab) => tab.id));
  // A route selected from the shared toolbar replaces the old main slot if
  // that route wasn't visible yet. Selecting a displayed sheet preserves slots.
  const previousId = workspaceTabIdForPath(previousPrimary.current);
  const resolvedSlots = slots.length > 1 && primaryId
    ? slots.map((id) => !slots.includes(primaryId) && id === previousId ? primaryId : id)
      .filter((id, index, all) => openIds.has(id) && all.indexOf(id) === index).slice(0, MAX_VISIBLE_WORKSPACE_SHEETS)
    : [];
  const liveSlots = resolvedSlots.length > 1 && resolvedSlots.includes(primaryId) ? resolvedSlots : [];
  const isMulti = liveSlots.length > 1;
  const selectedPaths = liveSlots.map((id) => workspaceTabRoute(tabs.tabs.find((tab) => tab.id === id))).filter(Boolean);
  const visiblePaths = new Set([location.pathname, ...selectedPaths]);

  useEffect(() => {
    // Only an actual route change should change focus. Tab metadata updates
    // (for example a study mode selection) must NOT steal focus from a cell.
    setSlots((previous) => {
      if (previous.length < 2) return previous;
      const currentId = workspaceTabIdForPath(location.pathname);
      const oldId = workspaceTabIdForPath(previousPrimary.current);
      if (previous.includes(currentId) || !previous.includes(oldId)) return previous;
      return previous.map((id) => id === oldId ? currentId : id);
    });
    previousPrimary.current = location.pathname;
    setFocusedPath(location.pathname);
  }, [location.pathname]);

  useEffect(() => {
    setSlots((previous) => {
      if (!previous.length) return previous;
      const remaining = previous.filter((id) => tabs.tabs.some((tab) => tab.id === id));
      return remaining.length === previous.length ? previous : (remaining.length > 1 ? remaining : []);
    });
  }, [tabs.tabs]);

  const panes = panesRef.current;
  clockRef.current += 1;
  panes.set(location.pathname, { location, seen: clockRef.current });
  for (const id of liveSlots) {
    const tab = tabs.tabs.find((item) => item.id === id);
    if (!tab) continue;
    const path = workspaceTabRoute(tab);
    if (!panes.has(path)) panes.set(path, {
      location: { ...location, pathname: path, search: "", state: { studyMode: tab.mode || "normal" }, key: `split-${id}` },
      seen: clockRef.current
    });
  }
  for (const [path] of panes) if (!visiblePaths.has(path) && !openIds.has(workspaceTabIdForPath(path))) panes.delete(path);
  const kept = [...panes.entries()].filter(([path]) => !visiblePaths.has(path)).sort((a,b) => b[1].seen - a[1].seen);
  kept.slice(KEPT_WORKSPACE_PANES).forEach(([path]) => panes.delete(path));

  function dockSheet(id, side = "end") {
    if (!openIds.has(id) || tabs.tabs.length < 2 || !primaryId) return;
    if (id === primaryId && !isMulti) {
      const index = tabs.tabs.findIndex((tab) => tab.id === id);
      const anchor = tabs.tabs[index + 1] || tabs.tabs[index - 1];
      if (!anchor) return;
      // Keep the selected sheet as one of two grid slots.
      setSlots(side === "start" ? [id, anchor.id] : [anchor.id, id]);
      navigate(workspaceTabRoute(anchor), { state: { studyMode: anchor.mode || "normal" } });
    } else {
      setSlots((old) => nextSplitSlots(old, primaryId, id, side));
    }
    setSplitPercent(50);
  }

  function closeSplit() { setSlots([]); setFocusedPath(location.pathname); }
  function resizeFromPointer(event) {
    const rect = layoutRef.current?.getBoundingClientRect();
    if (!rect) return;
    const stacked = window.matchMedia("(max-width: 640px)").matches;
    const offset = stacked ? event.clientY - rect.top : event.clientX - rect.left;
    const size = stacked ? rect.height : rect.width;
    if (size > 0) setSplitPercent(clampPercent(offset * 100 / size));
  }

  const entries = [...panes.entries()].sort(([a],[b]) => {
    const order = (path) => visiblePaths.has(path) ? selectedPaths.indexOf(path) : 100;
    return order(a) - order(b);
  });
  const paneNodes = entries.map(([path, pane]) => {
    const primary = path === location.pathname;
    const visible = visiblePaths.has(path);
    const focused = visible && (focusedPath === path || (!visiblePaths.has(focusedPath) && primary));
    const slot = isMulti ? selectedPaths.indexOf(path) : -1;
    const id = workspaceTabIdForPath(path);
    const tab = tabs.tabs.find((item) => item.id === id);
    const ar = currentAppLocale() === "ar";
    return <div key={path}
      className={primary ? "workspace-pane is-active" : visible ? "workspace-pane is-secondary" : "workspace-pane is-kept"}
      data-split-slot={visible && isMulti ? slot : undefined}
      data-focused={focused ? "true" : undefined}
      aria-hidden={visible ? undefined : "true"}
      inert={visible ? undefined : ""}
      onPointerDownCapture={() => { if (visible && !focused) setFocusedPath(path); }}
    >
      <WorkspacePaneVisibleContext.Provider value={visible}>
        <WorkspacePaneActiveContext.Provider value={focused}>
          <Routes location={primary ? location : pane.location}>
            <Route path="/materials/catalog/:materialSlug/mine/:sheetId/workspace" element={<Workspace user={user} variant="personal" />} />
            <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug/summary" element={<Workspace user={user} variant="summary" />} />
            <Route path="/materials/catalog/:materialSlug/sheets/:sheetSlug/workspace" element={<Workspace user={user} />} />
            <Route path="/whiteboards/:boardId/workspace" element={<Workspace user={user} variant="whiteboard" />} />
          </Routes>
        </WorkspacePaneActiveContext.Provider>
      </WorkspacePaneVisibleContext.Provider>
      {isMulti && visible && <div className="workspace-split-pane-heading" data-current={focused ? "" : undefined}>
        <button type="button" className="workspace-split-pane-select"
          onClick={() => setFocusedPath(path)}
          aria-pressed={focused}
          aria-label={ar ? `اختيار ${tab?.title || "الشيت"}` : `Select ${tab?.title || "sheet"}`}>
          <span className="workspace-split-active-dot" aria-hidden="true" />
          <span dir="auto">{tab?.title || (tab?.kind === "whiteboard" ? "Whiteboard" : id)}</span>
        </button>
        <button type="button" className="workspace-split-pane-remove"
          onClick={() => { setSlots((old) => old.filter((item) => item !== id)); if (focused) setFocusedPath(location.pathname); }}
          aria-label={ar ? "إزالة الشيت من التقسيم" : "Remove sheet from split"} title={ar ? "إزالة من التقسيم" : "Remove from split"}>×</button>
      </div>}
    </div>;
  });

  const splitStyle = isMulti ? /** @type {import("react").CSSProperties} */ ({ "--workspace-split-primary": `${splitPercent}%` }) : undefined;
  const ar = currentAppLocale() === "ar";
  const readers = <WorkspaceSplitContext.Provider value={{
    splitId: isMulti ? liveSlots[1] : "", splitIds: liveSlots, isMulti,
    toolbarHost, dropSplit: dockSheet, closeSplit,
    focusSheet: (id) => { const tab = tabs.tabs.find((item) => item.id === id); if (tab) setFocusedPath(workspaceTabRoute(tab)); }
  }}>
    <div ref={layoutRef} className={`workspace-split-layout${isMulti ? " is-split" : ""}`}
      data-pane-count={isMulti ? liveSlots.length : 1} style={splitStyle}>
      {paneNodes}
      {isMulti && <>
        <div className="workspace-split-shared-chrome workspace-v2">
          <div className="workspace-v2-body"><section className="workspace-v2-reader" ref={setToolbarHost} /></div>
        </div>
        {liveSlots.length === 2 && <div role="separator" className="workspace-split-divider" aria-label={ar ? "تغيير حجم تقسيم PDF" : "Resize PDF split"}
          aria-orientation={typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? "horizontal" : "vertical"}
          aria-valuemin={28} aria-valuemax={72} aria-valuenow={Math.round(splitPercent)} tabIndex={0}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget.querySelector("button")) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeFromPointer(event);
          }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeFromPointer(event); }}
          onKeyDown={(event) => {
            const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 5 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -5 : 0;
            if (delta) { event.preventDefault(); setSplitPercent((n) => clampPercent(n + delta)); }
          }}
        ><span className="workspace-split-grip" aria-hidden="true" />
          <button type="button" className="workspace-split-close" onClick={closeSplit}
            aria-label={ar ? "إغلاق تقسيم الشاشة" : "Close split view"}
            title={ar ? "إغلاق تقسيم الشاشة" : "Close split view"}>×</button>
        </div>}
      </>}
    </div>
  </WorkspaceSplitContext.Provider>;
  return <>{readers}<FocusVideoPlayer /></>;
}
