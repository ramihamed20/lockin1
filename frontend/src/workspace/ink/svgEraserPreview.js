import { eraserSpaceScale } from "./strokeModel.js";
import { inkSvgMaskBounds } from "./inkSvgMaskBounds.js";
let svgPreviewSerial = 0;
// Own temporary defs/attributes only; never move React-owned annotation nodes.
export function createSvgEraserPreview() {
    let state = null;
    const ns = "http://www.w3.org/2000/svg";
    const element = (tag, attrs = {}) => { const node = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs))
        node.setAttribute(key, String(value)); return node; };
    function release() {
        if (!state)
            return;
        for (const entry of state.entries.values()) {
            if (entry.mask === null)
                entry.mark.removeAttribute("mask");
            else
                entry.mark.setAttribute("mask", entry.mask);
            if (entry.parentMask !== null)
                entry.parent.setAttribute("mask", entry.parentMask);
            entry.mark.style.visibility = "";
        }
        for (const mark of state.hidden)
            mark.style.visibility = "";
        state.defs.remove();
        state = null;
    }
    return {
        get active() { return state !== null; },
        paint(canvas, annotations, hiddenIds, pageAspect) {
            // At the mask cap the model may return new fragment geometry/IDs.
            // Those need the isolated raster renderer rather than existing SVG marks.
            if (annotations.some(annotation => (annotation.erasures?.length || 0) >= 32))
                return false;
            const original = canvas?.parentElement?.querySelector(":scope > svg.workspace-v2-annotation-layer");
            if (!original)
                return false;
            if (state && state.original !== original)
                release();
            if (!state) {
                const defs = element("defs", { class: "workspace-v2-svg-eraser-preview", "aria-hidden": "true" });
                const marks = new Map();
                for (const node of original.querySelectorAll("[data-annotation-id]"))
                    if (!node.classList.contains("workspace-v2-annotation-hit"))
                        marks.set(String(node.getAttribute("data-annotation-id")), node);
                state = { original, defs, marks, prefix: "eraser-preview-" + (++svgPreviewSerial) + "-", entries: new Map(), hidden: new Set(), common: null };
                original.append(defs);
            }
            const scale = eraserSpaceScale(pageAspect), present = new Set(annotations.map(a => String(a.id)));
            for (const id of hiddenIds)
                if (!present.has(String(id))) {
                    const mark = state.marks.get(String(id));
                    if (mark) {
                        mark.style.visibility = "hidden";
                        state.hidden.add(mark);
                    }
                }
            const current = annotations[0]?.erasures?.at(-1);
            const commonId = state.prefix + "current";
            if (current) {
                const dot = current.points.length === 1, tag = dot ? "circle" : "path";
                if (!state.common || state.common.tagName.toLowerCase() !== tag) {
                    const node = element(tag, { id: commonId });
                    if (state.common)
                        state.common.replaceWith(node);
                    else
                        state.defs.append(node);
                    state.common = node;
                }
                const attrs = dot ? { cx: current.points[0].x * scale.x, cy: current.points[0].y * scale.y, r: current.radius, fill: "black" } : { d: current.points.map((point, i) => `${i ? "L" : "M"}${point.x * scale.x} ${point.y * scale.y}`).join(" "), fill: "none", stroke: "black", "stroke-width": current.radius * 2, "stroke-linecap": "round", "stroke-linejoin": "round" };
                for (const [key, value] of Object.entries(attrs))
                    if (state.common.getAttribute(key) !== String(value))
                        state.common.setAttribute(key, String(value));
            }
            for (const annotation of annotations) {
                const id = String(annotation.id), mark = state.marks.get(id);
                if (!mark) {
                    release();
                    return false;
                }
                let entry = state.entries.get(id);
                if (!entry) {
                    const parent = mark.parentElement, parentMask = parent?.getAttribute("mask") ?? null;
                    const maskId = state.prefix + "mask-" + state.entries.size;
                    const mask = element("mask", { id: maskId, ...inkSvgMaskBounds(annotation), maskUnits: "userSpaceOnUse", maskContentUnits: "userSpaceOnUse" });
                    mask.append(element("rect", { x: 0, y: 0, width: 1000, height: 1000, fill: "white" }));
                    const sweeps = element("g", { transform: `scale(${1 / scale.x} ${1 / scale.y})` });
                    mask.append(sweeps);
                    state.defs.append(mask);
                    entry = { mark, parent, parentMask, mask: mark.getAttribute("mask"), sweeps, slots: [] };
                    state.entries.set(id, entry);
                    if (parentMask !== null)
                        parent.removeAttribute("mask");
                    mark.setAttribute("mask", "url(#" + maskId + ")");
                    mark.style.visibility = "";
                }
                const erasures = annotation.erasures || [];
                for (let index = 0; index < erasures.length; index++) {
                    const erasure = erasures[index];
                    const shared = current && index === erasures.length - 1 && erasure.radius === current.radius && erasure.points.length === current.points.length && erasure.points.every((point, i) => point.x === current.points[i].x && point.y === current.points[i].y);
                    const dot = erasure.points.length === 1, tag = shared ? "use" : dot ? "circle" : "path";
                    let slot = entry.slots[index];
                    if (!slot || slot.tagName.toLowerCase() !== tag) {
                        const next = element(tag);
                        if (slot)
                            slot.replaceWith(next);
                        else
                            entry.sweeps.append(next);
                        entry.slots[index] = slot = next;
                    }
                    const attrs = shared ? { href: "#" + commonId } : dot ? { cx: erasure.points[0].x * scale.x, cy: erasure.points[0].y * scale.y, r: erasure.radius, fill: "black" } : { d: erasure.points.map((point, i) => `${i ? "L" : "M"}${point.x * scale.x} ${point.y * scale.y}`).join(" "), fill: "none", stroke: "black", "stroke-width": erasure.radius * 2, "stroke-linecap": "round", "stroke-linejoin": "round" };
                    for (const [key, value] of Object.entries(attrs))
                        if (slot.getAttribute(key) !== String(value))
                            slot.setAttribute(key, String(value));
                }
                for (const slot of entry.slots.splice(erasures.length))
                    slot.remove();
            }
            return true;
        }, release
    };
}
