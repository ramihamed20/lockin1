/** Distinct silhouettes for the existing ink profiles, tinted with the chosen ink. */
export function PenNibIcon({ profile }) {
  const art = {
    ball: <><path d="M9 3h6l1 13-4 6-4-6Z"/><path d="M8 16h8M10 6h4M12 22v2"/><path d="M9 3h6l1 13H8Z" fill="currentColor" fillOpacity=".18"/></>,
    fountain: <><path d="M12 2 5 17l7 7 7-7Z"/><path d="M12 9v15M5 17h14"/><circle cx="12" cy="9" r="1.5" fill="currentColor"/><path d="m12 2 7 15h-7Z" fill="currentColor" fillOpacity=".2"/></>,
    brush: <><path d="M15 2c0 5 4 9 3 13s-5 6-9 6c-2 0-3 1-4 3 0-5 1-9 4-12s6-7 6-10Z" fill="currentColor" fillOpacity=".2"/><path d="M15 2c0 5 4 9 3 13s-5 6-9 6c-2 0-3 1-4 3 0-5 1-9 4-12s6-7 6-10ZM9 17l6-5"/></>,
    calligraphy: <><path d="M8 3h8l2 14-12 5Z" fill="currentColor" fillOpacity=".2"/><path d="M8 3h8l2 14-12 5ZM7 16l10-4M6 22v2m12-7v3"/></>,
    pointer: <><path d="m12 3 2.5 7.5L22 13l-7.5 2.5L12 23l-2.5-7.5L2 13l7.5-2.5Z" fill="currentColor" fillOpacity=".16"/><path d="m12 3 2.5 7.5L22 13l-7.5 2.5L12 23l-2.5-7.5L2 13l7.5-2.5ZM21 2v4m-2-2h4"/></>
  }[profile];
  return <svg width="26" height="28" viewBox="0 0 24 26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{art}</svg>;
}
