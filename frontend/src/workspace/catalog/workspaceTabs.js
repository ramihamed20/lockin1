import { useCallback, useEffect, useState } from "react";

/**
 * The documents open side by side in the Focus workspace: catalog sheets, the
 * student's own uploaded sheets and the reader's own whiteboards. Each tab is a route of its own, so a sheet tab
 * keeps its ink, reading position and Active Study run exactly as it would if
 * it were opened alone. Only the list of tabs lives here, per account, on this
 * device.
 */

export const MAX_WORKSPACE_TABS = 12;
const STORAGE_PREFIX = "lock-in.workspace-tabs.v1";
const CHANGE_EVENT = "lock-in:workspace-tabs";
const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/i;
const BOARD_ID = /^[a-z0-9-]{8,64}$/i;
const SHEET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STUDY_MODES = new Set(["normal", "active"]);

/**
 * @typedef {{ id: string, kind: "sheet" | "whiteboard" | "personal", materialSlug?: string, personalId?: string, sheetSlug?: string, title?: string, boardId?: string, number?: number, mode?: string }} WorkspaceTab
 * @typedef {{ tabs: WorkspaceTab[], activeId: string }} WorkspaceTabsState
 */

/** @returns {WorkspaceTabsState} */
function emptyTabs() {
  return { tabs: [], activeId: "" };
}

export function isWhiteboardId(value) {
  return BOARD_ID.test(String(value || ""));
}

export function sheetTabId(materialSlug, sheetSlug) {
  return `sheet:${materialSlug}/${sheetSlug}`;
}

export function personalTabId(sheetId) {
  return `mine:${sheetId}`;
}

export function whiteboardTabId(boardId) {
  return `board:${boardId}`;
}

export function sheetTab({ materialSlug, sheetSlug, title = "" }) {
  return { id: sheetTabId(materialSlug, sheetSlug), kind: "sheet", materialSlug, sheetSlug, title: String(title || sheetSlug).slice(0, 200) };
}

/** One of the student's own sheets; `materialSlug` is the subject it was added to. */
export function personalTab({ materialSlug, personalId, title = "" }) {
  return { id: personalTabId(personalId), kind: "personal", materialSlug, personalId, title: String(title || "").slice(0, 200) };
}

export function whiteboardTab({ boardId, number = 1 }) {
  return { id: whiteboardTabId(boardId), kind: "whiteboard", boardId, number };
}

export function createWhiteboardId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const words = new Uint32Array(4);
  globalThis.crypto.getRandomValues(words);
  return Array.from(words, (word) => word.toString(16).padStart(8, "0")).join("-");
}

/** The next free whiteboard number, so "Whiteboard 2" is never shown twice. */
export function nextWhiteboardNumber(tabs) {
  const used = new Set(tabs.filter((tab) => tab.kind === "whiteboard").map((tab) => tab.number));
  let number = 1;
  while (used.has(number)) number += 1;
  return number;
}

export function workspaceTabRoute(tab) {
  if (tab.kind === "whiteboard") return `/whiteboards/${encodeURIComponent(tab.boardId)}/workspace`;
  if (tab.kind === "personal") return `/materials/catalog/${encodeURIComponent(tab.materialSlug)}/mine/${encodeURIComponent(tab.personalId)}/workspace`;
  return `/materials/catalog/${encodeURIComponent(tab.materialSlug)}/sheets/${encodeURIComponent(tab.sheetSlug)}/workspace`;
}

function sanitizeTab(value) {
  if (!value || typeof value !== "object") return null;
  const mode = STUDY_MODES.has(value.mode) ? value.mode : undefined;
  if (value.kind === "sheet" && SLUG.test(value.materialSlug || "") && SLUG.test(value.sheetSlug || "")) {
    return { ...sheetTab(value), ...(mode ? { mode } : {}) };
  }
  if (value.kind === "personal" && SLUG.test(value.materialSlug || "") && SHEET_ID.test(value.personalId || "")) {
    return personalTab(value);
  }
  if (value.kind === "whiteboard" && BOARD_ID.test(value.boardId || "")) {
    const number = Number(value.number);
    return whiteboardTab({ boardId: value.boardId, number: Number.isSafeInteger(number) && number > 0 && number < 1000 ? number : 1 });
  }
  return null;
}

/** @returns {WorkspaceTabsState} */
export function sanitizeWorkspaceTabs(value) {
  const seen = new Set();
  const tabs = (Array.isArray(value?.tabs) ? value.tabs : []).flatMap((item) => {
    const tab = sanitizeTab(item);
    if (!tab || seen.has(tab.id)) return [];
    seen.add(tab.id);
    return [tab];
  }).slice(0, MAX_WORKSPACE_TABS);
  const activeId = tabs.some((tab) => tab.id === value?.activeId) ? value.activeId : (tabs[0]?.id || "");
  return { tabs, activeId };
}

/**
 * Makes `tab` the open one, adding it after the active tab when it is new. A
 * full strip drops its oldest tab that is not the active one.
 */
export function openWorkspaceTab(state, tab) {
  const current = sanitizeWorkspaceTabs(state);
  const existing = current.tabs.find((item) => item.id === tab.id);
  if (existing) {
    const tabs = tab.kind !== "whiteboard" && tab.title && existing.title !== tab.title
      ? current.tabs.map((item) => item.id === tab.id ? { ...item, title: tab.title } : item)
      : current.tabs;
    return { tabs, activeId: tab.id };
  }
  const tabs = [...current.tabs];
  const activeIndex = tabs.findIndex((item) => item.id === current.activeId);
  tabs.splice(activeIndex < 0 ? tabs.length : activeIndex + 1, 0, tab);
  while (tabs.length > MAX_WORKSPACE_TABS) {
    const oldest = tabs.findIndex((item) => item.id !== tab.id && item.id !== current.activeId);
    tabs.splice(oldest < 0 ? 0 : oldest, 1);
  }
  return sanitizeWorkspaceTabs({ tabs, activeId: tab.id });
}

/** Removes a tab; closing the open one moves to its neighbour. */
export function closeWorkspaceTab(state, id) {
  const current = sanitizeWorkspaceTabs(state);
  const index = current.tabs.findIndex((item) => item.id === id);
  if (index < 0) return { state: current, next: null };
  const tabs = current.tabs.filter((item) => item.id !== id);
  if (current.activeId !== id) return { state: { tabs, activeId: current.activeId }, next: null };
  const next = tabs[Math.min(index, tabs.length - 1)] || null;
  return { state: { tabs, activeId: next?.id || "" }, next };
}

export function updateWorkspaceTab(state, id, changes) {
  const current = sanitizeWorkspaceTabs(state);
  return sanitizeWorkspaceTabs({ ...current, tabs: current.tabs.map((item) => item.id === id ? { ...item, ...changes } : item) });
}

/** Drops the tabs of sheets that were deleted, wherever they were open. */
export function forgetPersonalTabs(owner, sheetIds, storage = globalThis.localStorage) {
  const gone = new Set(sheetIds.map(personalTabId));
  const current = readWorkspaceTabs(owner, storage);
  if (!current.tabs.some((tab) => gone.has(tab.id))) return current;
  const tabs = current.tabs.filter((tab) => !gone.has(tab.id));
  return writeWorkspaceTabs(owner, { tabs, activeId: gone.has(current.activeId) ? (tabs[0]?.id || "") : current.activeId }, storage);
}

function storageKey(owner) {
  return `${STORAGE_PREFIX}:${owner || "guest"}`;
}

export function readWorkspaceTabs(owner, storage = globalThis.localStorage) {
  try {
    return sanitizeWorkspaceTabs(JSON.parse(storage?.getItem(storageKey(owner)) || "null"));
  } catch {
    return emptyTabs();
  }
}

export function writeWorkspaceTabs(owner, state, storage = globalThis.localStorage) {
  const clean = sanitizeWorkspaceTabs(state);
  try {
    storage?.setItem(storageKey(owner), JSON.stringify(clean));
  } catch {
    // A full or blocked store only costs the strip its memory, not the documents.
  }
  if (globalThis.CustomEvent) globalThis.dispatchEvent?.(new globalThis.CustomEvent(CHANGE_EVENT, { detail: { owner } }));
  return clean;
}

/**
 * The tab strip for one account, kept in step across every mounted reader.
 * @returns {[WorkspaceTabsState, (change: (state: WorkspaceTabsState) => WorkspaceTabsState) => WorkspaceTabsState]}
 */
export function useWorkspaceTabs(owner) {
  const [state, setState] = useState(() => readWorkspaceTabs(owner));
  useEffect(() => {
    setState(readWorkspaceTabs(owner));
    const refresh = (event) => {
      if (event.type === CHANGE_EVENT && event.detail?.owner !== owner) return;
      setState(readWorkspaceTabs(owner));
    };
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [owner]);
  const update = useCallback((change) => {
    const next = writeWorkspaceTabs(owner, change(readWorkspaceTabs(owner)));
    setState(next);
    return next;
  }, [owner]);
  return [state, update];
}
