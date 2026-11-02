/** Recognisable pen bodies with a restrained ink-coloured tip. */
export function PenNibIcon({ profile }) {
  const ink = 'var(--workspace-tool-color, currentColor)';
  const art = {
    ball: <><rect x="9" y="3" width="8" height="17" rx="3" fill="currentColor" fillOpacity=".13"/><path d="M9 8V6a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v13H9ZM9 19l4 7 4-7M13 26v2M11 7h4"/><path d="M9 17h8v3H9Z" fill={ink} stroke="none"/><path d="M17 6h2v8"/></>,
    fountain: <><path d="M9 3h8v9H9Z" fill="currentColor" fillOpacity=".13"/><path d="M9 12V3h8v9M9 12l-3 8 7 7 7-7-3-8Z"/><path d="m9 12-3 8 7 7 7-7-3-8Z" fill={ink} fillOpacity=".35"/><path d="M13 17v10M9 12h8"/><circle cx="13" cy="17" r="1.2" fill="currentColor" stroke="none"/></>,
    brush: <><path d="M10 3h6l-1 15h-4Z" fill="currentColor" fillOpacity=".13"/><path d="M10 3h6l-1 15h-4ZM11 14h4"/><path d="M11 18c-4 3-2 7-6 9 7 2 14-1 10-9Z" fill={ink} fillOpacity=".65"/><path d="M11 18c-4 3-2 7-6 9 7 2 14-1 10-9Z"/></>,
    calligraphy: <><rect x="7" y="3" width="12" height="16" rx="2.5" fill="currentColor" fillOpacity=".13"/><path d="M7 17V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12ZM7 17h12M9 17v8l8-3v-5"/><path d="M9 20v5l8-3v-2Z" fill={ink} stroke="none"/><path d="M10 7h6"/></>,
    pointer: <><rect x="9" y="10" width="8" height="17" rx="3" fill="currentColor" fillOpacity=".13"/><rect x="9" y="10" width="8" height="17" rx="3"/><path d="M9 15h8"/><circle cx="13" cy="19" r="1.3" fill={ink} stroke="none"/><path d="M13 6V2M7 7 5 5m14 2 2-2" stroke={ink} strokeWidth="2"/></>
  }[profile];
  return <svg width="28" height="30" viewBox="0 0 28 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><g transform="rotate(28 14 16)">{art}</g></svg>;
}
