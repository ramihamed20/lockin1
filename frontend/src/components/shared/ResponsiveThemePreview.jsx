import { assetPath } from "../../lib/utils.js";

export function ResponsiveThemePreview({ character, theme, alt, className = "", sizes = "(max-width: 639px) 88vw, 320px", priority = false }) {
  const base = `/assets/themes/${character}-${theme}`;
  const sourceSet = (format) => `${assetPath(`${base}-320.${format}`)} 320w, ${assetPath(`${base}-640.${format}`)} 640w`;

  return (
    <picture>
      <source type="image/avif" srcSet={sourceSet("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={sourceSet("webp")} sizes={sizes} />
      <img
        className={className}
        src={assetPath(`${base}-640.webp`)}
        alt={alt}
        width="640"
        height="640"
        loading={priority ? "eager" : "lazy"}
        decoding="async"
      />
    </picture>
  );
}
