import { offlineDatabase } from "../../offline/database.js";
import { captureOfflineSession, currentOfflineUserId, mutateOfflineCache } from "../../offline/sessionScope.js";

/**
 * Legacy Lockin sessions predate the shared Focus reader. Keep their private
 * device-only images, per-page bookmarks and unsent notes account-scoped.
 * A logout invalidates outstanding writes via the existing offline fence.
 */
const readerKey = (documentId) => `lockin:legacy-reader:v1:${documentId}`;
const noteKey = (sessionId) => `lockin:legacy-note:v1:${sessionId}`;
const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 128;

function current(userId) {
  return Boolean(userId) && currentOfflineUserId() === String(userId);
}

function assertScope(userId) {
  if (!current(userId)) throw new Error("Offline session changed.");
  return captureOfflineSession(userId);
}

export async function readLegacyReaderState(userId, documentId) {
  if (!current(userId) || !validId(documentId)) return null;
  const value = await offlineDatabase.get(String(userId), readerKey(documentId));
  if (!value || value.version !== 1) return null;
  return {
    bookmarks: Array.isArray(value.bookmarks) ? value.bookmarks.filter((n) => Number.isSafeInteger(n) && n > 0) : [],
    images: Array.isArray(value.images) ? value.images.filter((image) =>
      image && image.type === "image" &&
      typeof image.src === "string" &&
      /^data:image\/(png|jpeg|webp);base64,/i.test(image.src) &&
      image.src.length < 3_000_000) : []
  };
}

export async function writeLegacyReaderState(userId, documentId, { bookmarks, images }) {
  if (!validId(documentId)) return;
  const assertCurrent = assertScope(userId);
  const record = { version: 1, bookmarks, images };
  await mutateOfflineCache(String(userId), () => offlineDatabase.putScoped(String(userId), readerKey(documentId), record, assertCurrent));
}

export async function readLegacyNoteDraft(userId, sessionId) {
  if (!current(userId) || !validId(sessionId)) return null;
  const value = await offlineDatabase.get(String(userId), noteKey(sessionId));
  return typeof value?.body === "string" ? value.body : null;
}

export async function writeLegacyNoteDraft(userId, sessionId, body) {
  if (!validId(sessionId)) return;
  const assertCurrent = assertScope(userId);
  await mutateOfflineCache(String(userId), () => offlineDatabase.putScoped(String(userId), noteKey(sessionId), { body, savedAt: new Date().toISOString() }, assertCurrent));
}

/** Never clear a newer edit when an earlier server request finally succeeds. */
export async function acknowledgeLegacyNoteDraft(userId, sessionId, savedBody) {
  if (!validId(sessionId)) return;
  const assertCurrent = assertScope(userId);
  await mutateOfflineCache(String(userId), () => offlineDatabase.updateScoped(
    String(userId), noteKey(sessionId),
    (saved) => saved?.body === savedBody ? undefined : saved,
    assertCurrent
  ));
}
