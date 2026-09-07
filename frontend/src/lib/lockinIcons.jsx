import { memo } from "react";

/**
 * Lock-in concept icons.
 *
 * Lucide stays the vocabulary for functional controls -- back, close, search,
 * edit, chevrons. These are the other half: the handful of ideas the product
 * is actually about, drawn here so they belong to Lock-in rather than to a
 * general-purpose set.
 *
 * THE SYSTEM (read this before drawing a new one)
 *
 * Grid        24x24 viewBox, everything inside a 20x20 live area (2 units of
 *             padding on every side), optically centred on (12, 12).
 * Stroke      1.9, round caps, round joins, `currentColor`, no fill on the
 *             outline. Identical to the Icon component's default so a concept
 *             icon and a Lucide control never look like two different sets
 *             sitting next to each other.
 * Corners     No sharp corner below 2 units of radius. The interface uses a
 *             10/14/18/22/26 radius scale and generous rounding is the single
 *             loudest thing about its shapes.
 * The core    Every concept icon contains exactly one filled element -- a small
 *             solid core carrying the idea's centre of gravity. Lucide never
 *             fills, so this one mark is what makes the family read as ours,
 *             and it is the rule to keep when adding an icon. One core, never
 *             two, never zero.
 * Weight      One core plus at most three outline strokes. Anything needing
 *             more detail than that is an illustration, not an icon.
 * Colour      `currentColor` only. Colour comes from the surface the icon sits
 *             on, so the same glyph works on gold, on muted text, and in a
 *             disabled row without a second asset. State is never carried by
 *             colour alone -- the label beside the icon carries it.
 * Sizes       28 and up for empty states and feature areas; 20-24 inside
 *             cards. Below 20 use Lucide instead: the core stops reading.
 * Direction   None of these are directional, so none mirror in RTL. An icon
 *             that ever does gets `data-mirror-rtl` like its Lucide siblings.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * `streak` has no concept icon. A streak reads as a flame, Lucide already
 * ships one the product uses, and two attempts at an original flame both read
 * as a droplet at every size -- the silhouette that says "flame" is close
 * enough to the generic one that redrawing it buys nothing and risks less
 * clarity. Use `<Icon name="flame" />`. Add an icon here only when the concept
 * is genuinely Lock-in's and the drawing is genuinely better than the generic
 * one; a weak original is worse than a good general-purpose glyph.
 *
 * ACCESSIBILITY
 * Decorative by default: `aria-hidden` unless a `title` is passed, which is
 * what an icon standing alone as the only label needs.
 */

/** The one filled mark each icon carries. */
function Core({ cx, cy, r }) {
  return <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;
}

const LOCKIN_ICONS = {
  // Two facing arcs closing on a solid centre: attention narrowing onto one
  // thing. The product's own mark, and the shape the rest of the set echoes.
  focus: (
    <>
      <path d="M8.5 4.8a8 8 0 0 0 0 14.4" />
      <path d="M15.5 4.8a8 8 0 0 1 0 14.4" />
      <Core cx={12} cy={12} r={2.6} />
    </>
  ),

  // A bound volume rather than an open book: study here is a body of material
  // you return to, not a page you are on.
  study: (
    <>
      <path d="M6 5.5A2 2 0 0 1 8 3.5h11.5v17H8a2 2 0 0 1-2-2Z" />
      <path d="M6 18.5a2 2 0 0 1 2-2h11.5" />
      <Core cx={13} cy={9.6} r={1.9} />
    </>
  ),

  // A climbing line whose last point has arrived and become solid.
  progress: (
    <>
      <path d="M4.5 16.5 9.5 11.5l3.5 3.5 5-5" />
      <path d="M4.5 20.2h15" />
      <Core cx={18.9} cy={9.4} r={2.2} />
    </>
  ),

  // Something earned and kept: a shield holding a solid centre.
  achievement: (
    <>
      <path d="M12 3.2 19 6v6c0 4.4-3.1 7.6-7 8.8-3.9-1.2-7-4.4-7-8.8V6Z" />
      <Core cx={12} cy={11.4} r={2.4} />
    </>
  ),

  // Standing, with the leading position lifted clear of the columns.
  rank: (
    <>
      <path d="M3.5 20.2h17" />
      <path d="M5.8 20.2v-5.4M18.2 20.2v-7.6" />
      <path d="M12 20.2v-9.6" />
      <Core cx={12} cy={6.4} r={2.4} />
    </>
  ),

  // Three figures, the near one solid. An enclosing arc with two dots inside
  // reads as a face, so the group is drawn as people rather than as a ring.
  community: (
    <>
      <circle cx="5.9" cy="10.4" r="1.8" />
      <circle cx="18.1" cy="10.4" r="1.8" />
      <path d="M2.6 18.6a3.7 3.7 0 0 1 2.5-3M21.4 18.6a3.7 3.7 0 0 0-2.5-3" />
      <path d="M6.6 20.4a5.4 5.4 0 0 1 10.8 0" />
      <Core cx={12} cy={8.6} r={2.6} />
    </>
  ),

  // Not yet yours. The shackle is closed and the core sits behind it.
  locked: (
    <>
      <rect x="4.6" y="10.4" width="14.8" height="10.1" rx="2.6" />
      <path d="M8.2 10.4V7.9a3.8 3.8 0 0 1 7.6 0v2.5" />
      <Core cx={12} cy={15.4} r={1.9} />
    </>
  ),

  // An arc still being drawn: the shape of something on its way.
  "coming-soon": (
    <>
      <path d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6" />
      <path d="M20.2 15.2a8.6 8.6 0 0 1-5 5" />
      <path d="M11 20.5A8.6 8.6 0 0 1 4.4 8.2" />
      <Core cx={12} cy={12} r={2.5} />
    </>
  )
};

export const LOCKIN_ICON_NAMES = Object.freeze(Object.keys(LOCKIN_ICONS));

/**
 * @typedef {object} LockinIconProps
 * @property {string} name
 * @property {number} [size]
 * @property {number} [strokeWidth]
 * @property {string} [title] Accessible name. Pass it only when the icon is the
 *   sole label for something; leaving it off keeps the icon out of the
 *   accessibility tree, which is right when text sits beside it.
 * @property {string} [className]
 */

/** @type {import("react").NamedExoticComponent<LockinIconProps>} */
export const LockinIcon = memo(function LockinIcon({
  name,
  size = 24,
  strokeWidth = 1.9,
  title = "",
  ...props
}) {
  const glyph = LOCKIN_ICONS[name];
  if (!glyph) return null;
  const labelled = Boolean(title);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : "true"}
      aria-label={labelled ? title : undefined}
      focusable="false"
      {...props}
    >
      {glyph}
    </svg>
  );
});
