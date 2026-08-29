import { assetPath } from "../../lib/utils.js";

export function ResponsiveMascot({ alt, className = "", sizes = "240px", priority = false }) {
  const sourceSet = (format) => `${assetPath(`/assets/mascot-study-320.${format}`)} 320w, ${assetPath(`/assets/mascot-study-640.${format}`)} 640w`;
  return (
    <picture className={className}>
      <source type="image/avif" srcSet={sourceSet("avif")} sizes={sizes} />
      <source type="image/webp" srcSet={sourceSet("webp")} sizes={sizes} />
      <img src={assetPath("/assets/mascot-study-320.webp")} width="320" height="318" alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" />
    </picture>
  );
}
