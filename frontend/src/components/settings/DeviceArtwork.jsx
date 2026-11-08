/** Code-native silhouettes stay sharp in every theme and at every screen size. */
export function DeviceArtwork({ type }) {
  return <svg className="settings-device-art" data-device-type={type} viewBox="0 0 100 84" fill="none" aria-hidden="true" focusable="false">
    {type === "phone" ? <>
      <rect x="30" y="4" width="40" height="75" rx="10" fill="var(--surface-3)" stroke="currentColor" strokeWidth="2.5" />
      <rect x="34" y="9" width="32" height="65" rx="6" fill="var(--accent-soft)" />
      <rect x="42" y="10" width="16" height="4" rx="2" fill="currentColor" />
      <path d="M44 70h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </> : type === "tablet" ? <>
      <rect x="17" y="6" width="66" height="73" rx="8" fill="var(--surface-3)" stroke="currentColor" strokeWidth="2.5" />
      <rect x="22" y="12" width="56" height="60" rx="3" fill="var(--accent-soft)" />
      <circle cx="50" cy="9" r="1" fill="currentColor" />
      <path d="M43 75h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </> : type === "computer" ? <>
      <rect x="12" y="12" width="76" height="52" rx="5" fill="var(--surface-3)" stroke="currentColor" strokeWidth="2.5" />
      <rect x="17" y="18" width="66" height="40" rx="2" fill="var(--accent-soft)" />
      <path d="M12 65 3 73c0 3 3 5 6 5h82c3 0 6-2 6-5l-9-8H12Z" fill="var(--surface-3)" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M39 67h22l3 5H36l3-5Z" fill="var(--surface-2)" />
    </> : <>
      <rect x="20" y="12" width="60" height="48" rx="5" fill="var(--surface-3)" stroke="currentColor" strokeWidth="2.5" />
      <rect x="25" y="17" width="50" height="37" rx="2" fill="var(--accent-soft)" />
      <path d="M50 61v12m-13 2h26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </>}
  </svg>;
}
