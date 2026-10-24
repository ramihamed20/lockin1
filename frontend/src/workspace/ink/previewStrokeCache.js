import { strokeRenderGeometry } from "./strokeModel.js";

/** Cache only immutable committed points used by one canvas preview gesture. */
export function createPreviewStrokeCache() {
  let entries = new WeakMap();
  return {
    get(annotation, PathConstructor, pageAspect = 1) {
      const points = annotation.points;
      const cached = entries.get(points);
      if (cached && cached.length === points.length && cached.type === annotation.type
        && cached.width === annotation.width && cached.profile === annotation.profile
        && cached.opacity === annotation.opacity && cached.smoothing === annotation.smoothing && cached.sensitivity === annotation.pressureSensitivity
        && cached.PathConstructor === PathConstructor && cached.pageAspect === pageAspect) return cached;
      const geometry = strokeRenderGeometry(annotation, pageAspect);
      const path = typeof PathConstructor === "function" && geometry.path ? new PathConstructor(geometry.path) : null;
      const entry = { length: points.length, type: annotation.type, width: annotation.width,
        profile: annotation.profile, opacity: annotation.opacity, smoothing: annotation.smoothing, sensitivity: annotation.pressureSensitivity,
        PathConstructor, pageAspect, geometry, path };
      entries.set(points, entry);
      return entry;
    },
    clear() { entries = new WeakMap(); }
  };
}
