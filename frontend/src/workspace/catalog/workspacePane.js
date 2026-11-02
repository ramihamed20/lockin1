import { createContext, useContext } from "react";

/**
 * Whether the reader rendering under it is the tab on screen.
 *
 * Open tabs stay mounted behind the visible one so switching back is instant
 * rather than a reload (see WorkspaceKeepAlive). A reader that is kept but not
 * shown must not act on the page: it takes no keyboard shortcuts, does not set
 * the document title, does not count reading time and does not claim the
 * active tab. Outside the keep-alive host every reader is the one on screen.
 */
export const WorkspacePaneActiveContext = createContext(true);

export function useWorkspacePaneActive() {
  return useContext(WorkspacePaneActiveContext);
}

/**
 * Split view is owned by the keep-alive host, not by individual PDF readers.
 * Both readers remain isolated; the currently focused pane alone receives
 * global keyboard commands and foreground study effects.
 */
export const WorkspaceSplitContext = createContext({ splitId: "", toggleSplit: () => {} });

export function useWorkspaceSplit() {
  return useContext(WorkspaceSplitContext);
}
