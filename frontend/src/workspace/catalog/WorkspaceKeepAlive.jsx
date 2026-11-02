/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- An ARIA grid pane may be selected by pointer; dividers accept arrows and pointer drag. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ownerStorageKey } from "../storage/workspaceSnapshot.js";
import { FocusVideoPlayer } from "./FocusVideoPlayer.jsx";
import { WorkspacePaneActiveContext, WorkspacePaneVisibleContext, WorkspaceSplitContext } from "./workspacePane.js";
import { personalTabId, sheetTabId, useWorkspaceTabs, whiteboardTabId, workspaceTabRoute } from "./workspaceTabs.js";
import { currentAppLocale } from "../../lib/i18n.js";
import { X } from "lucide-react";
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

const clampPercent = (number) => Math.max(20, Math.min(80, number));
const SIZE_PRESETS = [30, 40, 50, 60, 70];
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
  const [splitRowsPercent, setSplitRowsPercent] = useState(50);
  const [ratioMenu, setRatioMenu] = useState("");
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
    if (!isMulti) { setSplitPercent(50); setSplitRowsPercent(50); }
    setRatioMenu("");
  }

  // Removing the URL-owning pane must promote a remaining sheet to the main
  // route. Otherwise the grid disappears because its primary id is no longer
  // among the displayed slots.
  function removeSplitSheet(id) {
    const remaining = liveSlots.filter((item) => item !== id);
    if (remaining.length < 2) {
      closeSplit();
      // Removing the primary of a two-way view should leave the other
      // document on screen, never redisplay the sheet that was removed.
      if (id === primaryId && remaining.length === 1) {
        const nextTab = tabs.tabs.find((item) => item.id === remaining[0]);
        if (nextTab) navigate(workspaceTabRoute(nextTab), { state: { studyMode: nextTab.mode || "normal" } });
      }
      return;
    }
    if (id === primaryId) {
      const nextId = remaining.includes(workspaceTabIdForPath(focusedPath))
        ? workspaceTabIdForPath(focusedPath) : remaining[0];
      const nextTab = tabs.tabs.find((item) => item.id === nextId);
      if (nextTab) {
        setFocusedPath(workspaceTabRoute(nextTab));
        navigate(workspaceTabRoute(nextTab), { state: { studyMode: nextTab.mode || "normal" } });
      }
    } else if (workspaceTabIdForPath(focusedPath) === id) {
      setFocusedPath(location.pathname);
    }
    setSlots(remaining);
  }

  function closeSplit() { setSlots([]); setRatioMenu(""); setFocusedPath(location.pathname); }
  function splitAxisIsRows(axis) {
    const stacked = window.matchMedia("(max-width: 640px)").matches;
    return axis === "primary" ? (stacked && liveSlots.length !== 4) : (!stacked || liveSlots.length === 4);
  }
  function resizeFromPointer(event, axis) {
    const rects = [...(layoutRef.current?.querySelectorAll(".workspace-pane[data-split-slot]") || [])]
      .map((node) => node.getBoundingClientRect());
    if (rects.length < 2) return;
    const rows = splitAxisIsRows(axis);
    const start = Math.min(...rects.map((rect) => rows ? rect.top : rect.left));
    const end = Math.max(...rects.map((rect) => rows ? rect.bottom : rect.right));
    const current = rows ? event.clientY : event.clientX;
    if (end > start) {
      const set = axis === "primary" ? setSplitPercent : setSplitRowsPercent;
      set(clampPercent((current - start) * 100 / (end - start)));
    }
  }
  function splitDivider(axis) {
    const primary = axis === "primary";
    const percent = primary ? splitPercent : splitRowsPercent;
    const set = primary ? setSplitPercent : setSplitRowsPercent;
    const ar = currentAppLocale() === "ar";
    const rows = splitAxisIsRows(axis);
    return <div key={axis} role="separator"
      className="workspace-split-divider"
      data-axis={axis}
      aria-label={ar ? (primary ? "تغيير حجم تقسيم الشيتات" : "تغيير ارتفاع الشيتات") : (primary ? "Resize sheet columns" : "Resize sheet rows")}
      aria-orientation={rows ? "horizontal" : "vertical"}
      aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(percent)}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setRatioMenu("");
        resizeFromPointer(event, axis);
      }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeFromPointer(event, axis); }}
      onKeyDown={(event) => {
        const delta = ["ArrowRight", "ArrowDown"].includes(event.key) ? 5 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -5 : 0;
        if (delta) { event.preventDefault(); set((value) => clampPercent(value + delta)); }
        if (event.key === "Escape") setRatioMenu("");
      }}
    >
      <span className="workspace-split-grip" aria-hidden="true" />
      <button type="button" className="workspace-split-ratio-toggle" aria-label={ar ? "اختيار نسبة التقسيم" : "Choose split ratio"}
        title={ar ? "نسب تقسيم جاهزة" : "Split size presets"}
        aria-expanded={ratioMenu === axis}
        onClick={() => setRatioMenu((opened) => opened === axis ? "" : axis)}>{Math.round(percent)}%</button>
      {ratioMenu === axis && <div className="workspace-split-ratio-presets" role="group" aria-label={ar ? "نسب تقسيم الشيتات" : "Sheet split presets"}>
        {SIZE_PRESETS.map((value) => <button key={value} type="button" className={Math.round(percent) === value ? "is-selected" : ""}
          aria-label={`${value}/${100 - value}`} aria-pressed={Math.round(percent) === value}
          onClick={() => { set(value); setRatioMenu(""); }} >{value}/{100 - value}</button>)}
      </div>}
    </div>;
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
      aria-label={visible && isMulti ? (tab?.title || (ar ? "شيت" : "Sheet")) : undefined}
      inert={visible ? undefined : ""}
      onPointerDownCapture={(event) => { if (event.target instanceof Element && event.target.closest(".workspace-split-pane-remove")) return; if (visible && !focused) setFocusedPath(path); }}
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
      {isMulti && visible && <button type="button" className="workspace-split-pane-remove"
        onClick={() => removeSplitSheet(id)}
        aria-label={ar ? `إزالة ${tab?.title || "الشيت"} من التقسيم` : `Remove ${tab?.title || "sheet"} from split`}
        title={ar ? "إزالة من التقسيم" : "Remove from split"}><X size={15} strokeWidth={1.9} aria-hidden="true" /></button>}
    </div>;
  });

  const splitStyle = isMulti ? /** @type {import("react").CSSProperties} */ ({ "--workspace-split-primary": `${splitPercent}%`, "--workspace-split-secondary": `${splitRowsPercent}%` }) : undefined;
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
        {splitDivider("primary")}
        {liveSlots.length >= 3 && splitDivider("secondary")}
      </>}
    </div>
  </WorkspaceSplitContext.Provider>;
  return <>{readers}<FocusVideoPlayer /></>;
}
