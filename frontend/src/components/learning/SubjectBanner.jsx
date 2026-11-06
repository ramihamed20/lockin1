import "./subject-banner.css";

const illustrations = [
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
  [/biochem|chemistry|dental[- ]materials?/, <>
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

export function SubjectBanner({ material }) {
  const subject = `${material.slug} ${material.title}`.toLowerCase();
  const illustration = illustrations.find(([pattern]) => pattern.test(subject))?.[1] ?? (
    <path d="M0-17C-22-31-42-29-57-22v45C-37 17-20 19 0 30c20-11 37-13 57-7v-45c-15-7-35-9-57 5v47Z M-45-10q19-5 31 4m28 0q12-9 31-4" fill="currentColor" fillOpacity=".12" />
  );

  return (
    <svg className="subject-banner-art" viewBox="0 0 360 104" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" opacity=".2">
        <circle cx="37" cy="88" r="56" />
        <circle cx="37" cy="88" r="72" />
        <circle cx="324" cy="18" r="53" />
        <circle cx="324" cy="18" r="69" />
      </g>
      <g transform="translate(180 52)" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {illustration}
      </g>
    </svg>
  );
}
