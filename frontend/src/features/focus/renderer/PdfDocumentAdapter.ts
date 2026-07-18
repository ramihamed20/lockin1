import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { FocusDocumentRenderer } from "../contracts/ports";

GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfDocumentAdapter implements FocusDocumentRenderer {
  #document: PDFDocumentProxy | null = null;
  #renderTasks = new Map<number, RenderTask>();

  async load(url: string): Promise<{ pageCount: number }> {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/api/v1/files/")) {
      throw new Error("Focus documents must use an authorized Lock-in file endpoint.");
    }
    this.#document = await getDocument({
      url: parsed.pathname + parsed.search,
      withCredentials: true,
      disableAutoFetch: false,
      disableStream: false,
      disableRange: false
    }).promise;
    return { pageCount: this.#document.numPages };
  }

  async renderPage(pageNumber: number, canvas: HTMLCanvasElement, scale: number) {
    if (!this.#document) throw new Error("The Focus document has not loaded.");
    this.releasePage(pageNumber);
    const page = await this.#document.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("The browser cannot render this document.");
    const task = page.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
    this.#renderTasks.set(pageNumber, task);
    try {
      await task.promise;
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => "str" in item ? [item.str] : []).join(" ");
      return { width: viewport.width, height: viewport.height, text };
    } finally {
      if (this.#renderTasks.get(pageNumber) === task) {
        this.#renderTasks.delete(pageNumber);
        page.cleanup();
      }
    }
  }

  releasePage(pageNumber: number): void {
    this.#renderTasks.get(pageNumber)?.cancel();
    this.#renderTasks.delete(pageNumber);
  }

  async destroy(): Promise<void> {
    this.#renderTasks.forEach((task) => task.cancel());
    this.#renderTasks.clear();
    await this.#document?.destroy();
    this.#document = null;
  }
}
