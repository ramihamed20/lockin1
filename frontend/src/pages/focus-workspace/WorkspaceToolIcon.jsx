/** Toolbar-only glyphs; pen inspector controls stay unchanged. */
export function WorkspaceToolIcon({ tool, fallback: Fallback }) {
  const art = {
    pen: <><path d="m8 18 3-9 4-5 5 5-5 4-9 3Z" fill="currentColor" fillOpacity=".12"/><path d="m8 18 3-9 4-5 5 5-5 4-9 3Z M11 9l4 4 M8 18l5-5 M15 4l5 5 M5 21h14"/><circle cx="13" cy="11" r=".8" fill="currentColor" stroke="none"/></>,
    highlighter: <><path d="m7 13 7-9 6 5-8 8Z" fill="currentColor" fillOpacity=".12"/><path d="m7 13 7-9 6 5-8 8Z M7 13l5 4-2 3H4l1-5Z"/><path d="M4 22h15" stroke="#e9b536" strokeWidth="2.5"/></>,
    eraser: <><path d="m4 14 9-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 9H9l-5-4a2 2 0 0 1 0-3Z M8 10l9 8 M13 21h8"/><path d="m4 14 4-4 9 8-4 3H9l-5-4a2 2 0 0 1 0-3Z" fill="currentColor" fillOpacity=".12"/></>,
    select: <><path d="M8 19C2 18 2 11 6 6c4-4 12-4 15 1 3 6-2 13-8 13" strokeDasharray="2.2 3"/><path d="M9 17c-3 0-4 3-2 5 2 2 5-1 3-3l-2-1"/></>
  }[tool];
  return art ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{art}</svg> : <Fallback size={22} strokeWidth={1.6} aria-hidden="true" />;
}
