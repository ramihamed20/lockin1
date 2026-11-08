import assert from "node:assert/strict";
import test from "node:test";
import { installOfflineEnvironment } from "./helpers/offlineEnvironment.js";

installOfflineEnvironment();
const {
  readLegacyReaderState, writeLegacyReaderState,
  readLegacyNoteDraft, writeLegacyNoteDraft, acknowledgeLegacyNoteDraft
} = await import("../src/components/lock-in/legacyDrafts.js");

test("legacy Lockin bookmarks and local images survive a reader remount", async () => {
  localStorage.setItem("lock-in.offline-current-user-id", "student-a");
  const image = { id: "image-1", type: "image", page: 3, src: "data:image/png;base64,YQ==", x: 0, y: 0, width: 10, height: 10 };
  await writeLegacyReaderState("student-a", "document-a", { bookmarks: [1, 3], images: [image] });
  assert.deepEqual(await readLegacyReaderState("student-a", "document-a"), {
    bookmarks: [1, 3], images: [image]
  });
  assert.equal(await readLegacyReaderState("student-a", "document-b"), null);
});

test("unsent session notes survive refresh, and stale acknowledgement never drops a newer draft", async () => {
  localStorage.setItem("lock-in.offline-current-user-id", "student-a");
  await writeLegacyNoteDraft("student-a", "session-a", "First edit");
  await writeLegacyNoteDraft("student-a", "session-a", "Later edit");
  await acknowledgeLegacyNoteDraft("student-a", "session-a", "First edit");
  assert.equal(await readLegacyNoteDraft("student-a", "session-a"), "Later edit");
  await acknowledgeLegacyNoteDraft("student-a", "session-a", "Later edit");
  assert.equal(await readLegacyNoteDraft("student-a", "session-a"), null);
});

test("account-fenced drafts remain private and reject writes after switching account", async () => {
  localStorage.setItem("lock-in.offline-current-user-id", "student-a");
  await writeLegacyNoteDraft("student-a", "session-a", "Private draft");
  localStorage.setItem("lock-in.offline-current-user-id", "student-b");
  assert.equal(await readLegacyNoteDraft("student-a", "session-a"), null);
  await assert.rejects(writeLegacyNoteDraft("student-a", "session-a", "Bad write"), /Offline session changed/);
  assert.equal(await readLegacyNoteDraft("student-b", "session-a"), null);
  localStorage.setItem("lock-in.offline-current-user-id", "student-a");
  assert.equal(await readLegacyNoteDraft("student-a", "session-a"), "Private draft");
});
