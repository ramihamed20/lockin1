/** A PDF transfer may be slow, but it must keep making progress. */
export const PDF_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

function integrityError() {
  return Object.assign(new Error("Download integrity check failed."), { code: "integrity" });
}

/** Race every await, including transports that do not promptly honor abort. */
function untilAborted(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchPdfBlob(item, { signal: parentSignal, onProgress, assertCurrent }) {
  const expected = Number(item.size);
  if (!/^[a-f0-9]{64}$/i.test(item.checksum || "") || !Number.isSafeInteger(expected) || expected < PDF_SIGNATURE.length) throw integrityError();
  const controller = new AbortController();
  const signal = controller.signal;
  const cancel = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", cancel, { once: true });
  if (parentSignal.aborted) cancel();
  let timer;
  const progress = () => {
    globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => controller.abort(Object.assign(
      new Error("The PDF download stopped responding. It will be retried."), { code: "timeout", name: "TimeoutError" }
    )), PDF_DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  const check = () => { signal.throwIfAborted(); assertCurrent(); };
  try {
    check();
    progress();
    const response = await untilAborted(fetch(item.download_url, {
      credentials: "include", cache: "no-store", signal, priority: "low"
    }), signal);
    check();
    if (!response.ok) throw Object.assign(new Error("Download failed."), { status: response.status });
    progress();
    const chunks = [];
    const prefix = new Uint8Array(PDF_SIGNATURE.length);
    let received = 0, prefixSize = 0;
    const accept = (value) => {
      if (!value.byteLength) return;
      // Reject an oversized stream before retaining another chunk in memory.
      if (received + value.byteLength > expected) throw integrityError();
      if (prefixSize < prefix.length) {
        const part = value.subarray(0, prefix.length - prefixSize);
        prefix.set(part, prefixSize);
        prefixSize += part.length;
        if (prefixSize === prefix.length && PDF_SIGNATURE.some((byte, index) => prefix[index] !== byte)) throw integrityError();
      }
      chunks.push(value);
      received += value.byteLength;
      progress();
      onProgress(Math.min(1, received / expected));
    };
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          check();
          const { value, done } = await untilAborted(reader.read(), signal);
          if (done) break;
          accept(value);
        }
      } finally {
        // Cleanup itself must not wait indefinitely for a broken transport.
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } else {
      accept(new Uint8Array(await untilAborted(response.arrayBuffer(), signal)));
    }
    check();
    globalThis.clearTimeout(timer);
    if (prefixSize < prefix.length || received !== expected) throw integrityError();
    const blob = new Blob(chunks, { type: "application/pdf" });
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    check();
    const checksum = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (checksum !== item.checksum.toLowerCase()) throw integrityError();
    return blob;
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    parentSignal.removeEventListener("abort", cancel);
  }
}
