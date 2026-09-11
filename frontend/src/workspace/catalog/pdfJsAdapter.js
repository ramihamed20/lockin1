import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// Keep the browser runtime and worker coupled to the same installed package.
// The legacy distribution is intentional: it preserves support for older iPad
// Safari releases while still using the current, maintained PDF.js release.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export function loadPdfLibrary() {
  return Promise.resolve(pdfjsLib);
}

export const PDFJS_VERSION = pdfjsLib.version;
