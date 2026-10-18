/** Owns one bounded temporary surface for per-stroke preview masks. */
export function createIsolatedInkPreview(createCanvas) {
    let surface = null;
    let isolated = null;
    return {
        paint(context, annotation, { width, height, ratio, x = 0, y = 0, surfaceWidth = width, surfaceHeight = height }, drawStroke) {
            if (!annotation.erasures?.length)
                return drawStroke(context, annotation);
            if (!surface)
                surface = createCanvas();
            const pixelWidth = Math.max(1, Math.floor(surfaceWidth * ratio));
            const pixelHeight = Math.max(1, Math.floor(surfaceHeight * ratio));
            if (surface.width !== pixelWidth)
                surface.width = pixelWidth;
            if (surface.height !== pixelHeight)
                surface.height = pixelHeight;
            if (!isolated)
                isolated = surface.getContext("2d");
            if (!isolated)
                return 0;
            isolated.setTransform(1, 0, 0, 1, 0, 0);
            isolated.clearRect(0, 0, pixelWidth, pixelHeight);
            isolated.setTransform(width * ratio / 1000, 0, 0, height * ratio / 1000, -x * ratio, -y * ratio);
            isolated.save();
            const geometryTime = drawStroke(isolated, annotation);
            isolated.restore();
            // destination-out now affects this stroke alone. The masked result is
            // composited in the original order without cutting earlier marks.
            context.save();
            context.globalAlpha = 1;
            context.globalCompositeOperation = "source-over";
            // Copy in native pixels: the page transform can have fractional CSS
            // dimensions, so stretching a rounded backing store would blur edges.
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.drawImage(surface, 0, 0);
            context.restore();
            return geometryTime;
        },
        release() {
            if (surface) {
                surface.width = 0;
                surface.height = 0;
            }
            surface = null;
            isolated = null;
        }
    };
}
