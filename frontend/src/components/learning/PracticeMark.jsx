import "./practice-mark.css";

/**
 * The teacher's mark on a slide. It sits on the image by percentage so it
 * follows the picture at any size, and it is not mirrored in Arabic: the image
 * itself does not mirror.
 * @param {{ mark: { x: number, y: number, shape: "circle" | "arrow" } }} props
 */
export function PracticeMark({ mark }) {
  const place = /** @type {import("react").CSSProperties} */ ({ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` });
  if (mark.shape === "circle") return <span className="practice-mark practice-mark--circle" style={place} aria-hidden="true" />;
  // The arrow points at the spot from the side with the most room.
  return (
    <svg className="practice-mark practice-mark--arrow" data-from={mark.x < 0.3 ? "end" : "start"} style={place} viewBox="0 0 64 24" aria-hidden="true" focusable="false">
      <path d="M2 9H40V2L62 12L40 22V15H2Z" />
    </svg>
  );
}
