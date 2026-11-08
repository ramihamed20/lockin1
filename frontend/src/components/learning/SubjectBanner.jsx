import "./subject-banner.css";

/** @type {Array<[RegExp, import("react").ReactNode]>} */
const illustrations = [
  [/embryo/, <>
    <circle r="32" fill="currentColor" fillOpacity=".10" />
    <circle cx="-11" cy="-9" r="10" /><circle cx="10" cy="-9" r="10" />
    <circle cx="-11" cy="12" r="10" /><circle cx="10" cy="12" r="10" />
    <circle cx="-71" r="15" opacity=".55" /><circle cx="71" r="15" opacity=".55" />
  </>],
  [/english/, <>
    <rect x="-68" y="-28" width="74" height="45" rx="10" fill="currentColor" fillOpacity=".13" />
    <path d="M-57 17v10l16-10M-53 5l12-23L-29 5m-19-8h14M26-20h35a9 9 0 0 1 9 9v25a9 9 0 0 1-9 9H49l-13 10V23H26a9 9 0 0 1-9-9v-25a9 9 0 0 1 9-9Z M31-4h24M31 6h18" />
  </>],
  [/remov/, <>
    <path d="M-64 21c0-37 28-56 64-56s64 19 64 56H45c0-22-19-37-45-37s-45 15-45 37Z" fill="currentColor" fillOpacity=".19" />
    <path d="M-52 3l11 4m3-24 9 10m17-20 4 12m20-12-4 12m30-2-9 10M52 3 41 7" />
  </>],
  [/fixed|prostho/, <>
    <path d="M-49 26l-6-30q-4-17 12-22 10-4 19 4 9-8 19-4Q8-20 5-4L0 26Z M8 26 4-4q-4-17 12-22 10-4 19 4 9-8 19-4 15 6 11 22l-5 30Z" fill="currentColor" fillOpacity=".19" />
    <path d="M-49 13h49m8 0h52M-7 13H12M-77 24h12m146 0h12" />
  </>],
  [/conserv/, <>
    <path d="M-12-18C-28-34-49-21-43-5c4 10 6 13 8 27 2 16 12 13 15 0 5-22 10-22 16 0 3 13 13 16 15 0 2-14 4-17 8-27 6-16-15-29-31-13Z" fill="currentColor" fillOpacity=".17" />
    <path d="M-22-16q10 9 20 0M13-10l25-17 10 13-27 15M48-14l26-14M-73-11h13m-6-6v13" />
  </>],
  [/dental[- ]materials?/, <>
    <path d="M-58 13H58L43 31h-86Z M-34 13l13-29 18 7 11-17 26 11 11 28Z" fill="currentColor" fillOpacity=".15" />
    <path d="M-21-16l16 29M8-26 12 13m22-28L25 13M-73-18h13m-6-7v14M68-7h14m-7-7V0" />
  </>],
  [/histo/, <>
    <path d="M-135 15Q-110-12-85 12T-35 12T15 12T65 12T115 12T145 12V28H-135Z" fill="currentColor" opacity=".12" />
    {[-112, -74, -36, 2, 40, 78, 116].map((x, i) => (
      <g key={x} transform={`translate(${x} ${i % 2 ? -2 : 5})`}>
        <path d="M-16-20Q0-34 16-20L18 15Q0 26-18 15Z" fill="currentColor" fillOpacity=".10" />
        <ellipse cy="-3" rx="5" ry="8" fill="currentColor" stroke="none" opacity=".55" />
      </g>
    ))}
  </>],
  [/physio/, <>
    <path d="M0 27C-68-13-23-44 0-21C23-44 68-13 0 27Z" fill="currentColor" fillOpacity=".13" />
    <path d="M-141 2h99l10-10 9 17 11-30L1 16 11 2h130" />
  </>],
  [/biochem|chemistry/, <>
    <path d="M-53-23l24-14 24 14v28l-24 14-24-14Z M-5-23l24-14 24 14v28L19 19-5 5Z M43-23l31-11 M43 5l30 17 M-53-23l-32-12 M-53 5l-30 19" />
    {[[74, -34], [73, 22], [-85, -35], [-83, 24], [-29, 19], [19, -37]].map(([x, y]) => (
      <circle key={x} cx={x} cy={y} r="6" fill="currentColor" fillOpacity=".25" />
    ))}
  </>],
  [/micro/, <>
    <rect x="-65" y="-15" width="64" height="30" rx="15" transform="rotate(-19)" fill="currentColor" fillOpacity=".17" />
    <rect x="22" y="-17" width="61" height="28" rx="14" transform="rotate(19)" fill="currentColor" fillOpacity=".17" />
    <path d="M-76 13q-28-6-34 10m88-41q16-22 31-16m64 63q13 17 31 8m-79-43q-12-14-26-13" />
    <path d="M-48 9h3m14-6h3m73 5h3m15 6h3" strokeWidth="5" />
  </>],
  [/pharm/, <>
    <rect x="-17" y="-34" width="34" height="68" rx="17" transform="rotate(36)" fill="currentColor" fillOpacity=".18" />
    <path d="M-14-10L14 10" />
    <circle cx="64" cy="12" r="20" fill="currentColor" fillOpacity=".12" />
    <path d="M54 12h20M-80-9h23m-11-11v22" />
  </>],
  [/patho/, <>
    <path d="M-51-27Q-32-38-12-23T23-21Q55-36 66-5T48 23Q20 38-5 21T-42 25Q-73 20-66-6T-51-27Z" fill="currentColor" fillOpacity=".16" />
    <path d="M-37-9q13-15 28 0t31 0t29 0M-42 9q15-12 31 0t33 0" />
    <circle cx="35" cy="10" r="6" fill="currentColor" />
  </>],
  [/dental|prostho|conserv|tooth|oral/, <>
    <path d="M0-25C-15-41-39-32-40-14C-41-3-35 1-31 10C-27 18-29 35-21 37C-11 39-12 14 0 14S11 39 21 37C29 35 27 18 31 10C35 1 41-3 40-14C39-32 15-41 0-25Z" fill="currentColor" fillOpacity=".16" />
    <path d="M-18-24q19 14 37 0M-76-14h18m-9-9v18m121 30h19m-9-9v18" />
  </>],
  [/anatom/, <>
    <path d="M-12-24c-9-11-28-7-27 5 0 7 7 10 9 16l4 24c2 10 18 12 21 1 6 9 22 5 21-5l-3-26c-1-7 7-14 3-20-5-9-21-7-28 5Z" transform="rotate(30)" fill="currentColor" fillOpacity=".15" />
    <path d="M-63-11h21m-34 20h31m85-20h28M44 9h42" opacity=".65" />
  </>],
  [/(?:^|[-\s])it(?:$|[-\s])|comput/, <>
    <rect x="-55" y="-26" width="110" height="51" rx="7" fill="currentColor" fillOpacity=".12" />
    <path d="M-30-10l-12 9 12 9m60-18 12 9-12 9M8-14-8 12M-70 31H70" />
  </>],
];

export function SubjectBanner({ material, variant = "banner" }) {
  const subject = `${material?.slug || ""} ${material?.title || ""}`.toLowerCase();
  const illustration = illustrations.find(([pattern]) => pattern.test(subject))?.[1] ?? (
    <path d="M0-17C-22-31-42-29-57-22v45C-37 17-20 19 0 30c20-11 37-13 57-7v-45c-15-7-35-9-57 5v47Z M-45-10q19-5 31 4m28 0q12-9 31-4" fill="currentColor" fillOpacity=".12" />
  );

  return (
    <svg className="subject-banner-art" viewBox={variant === "cover" ? "83 4 194 96" : "0 0 360 104"} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" opacity=".2">
        <circle cx="37" cy="88" r="56" />
        <circle cx="37" cy="88" r="72" />
        <circle cx="324" cy="18" r="53" />
        <circle cx="324" cy="18" r="69" />
        <path d="M17 28h58m-45 9h28m250 35h34m-24 9h14M100 18h8m-4-4v8m148 64h10m-5-5v10" />
      </g>
      <ellipse cx="180" cy="52" rx="102" ry="43" fill="currentColor" opacity=".08" />
      <g fill="currentColor" opacity=".24">
        <circle cx="57" cy="72" r="3" /><circle cx="87" cy="27" r="2.5" />
        <circle cx="291" cy="64" r="3" /><circle cx="302" cy="79" r="2" />
      </g>
      <g transform="translate(180 52)" fill="none" stroke="currentColor" strokeWidth={variant === "cover" ? 3.4 : 2.7} strokeLinecap="round" strokeLinejoin="round">
        {illustration}
      </g>
    </svg>
  );
}
