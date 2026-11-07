import { useLayoutEffect, useRef } from "react";

/**
 * Lets open-sheet tabs reserve exactly the space occupied by the color and
 * starred-pen controls. The tab strip remains scrollable, without the palettes
 * overlapping tab titles or taking another toolbar row on iPad.
 */
export function ToolbarAccessories({ children }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const toolbar = element?.closest(".workspace-v2-toolbar");
    if (!element || !toolbar) return undefined;

    const measure = () => {
      const width = Math.ceil(element.getBoundingClientRect().width + 12);
      toolbar.style.setProperty("--workspace-accessories-reserve", `${width}px`);
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      toolbar.style.removeProperty("--workspace-accessories-reserve");
    };
  }, []);

  return <div ref={ref} className="workspace-toolbar-accessories">{children}</div>;
}
