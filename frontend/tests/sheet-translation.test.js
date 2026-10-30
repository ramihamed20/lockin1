import assert from "node:assert/strict";
import test from "node:test";
import { getSheetTranslation, parseTranslation, sheetTranslationAdminApi } from "../src/api/sheetTranslation.js";
import { __testing } from "../src/api/client.js";
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; __testing.reset(); });
const ready = { page: 2, target_language: "ar", status: "ready", source_text: "Enamel", translated_text: "المينا" };

test("translation is tied to the requested physical page and language", () => {
  assert.equal(parseTranslation(ready, 2), ready);
  for (const payload of [null, { ...ready, page: 1 }, { ...ready, target_language: "en" }, { ...ready, status: "complete" }, { ...ready, translated_text: null }]) assert.throws(() => parseTranslation(payload, 2));
});

test("reader fetches without uploading a PDF or initiating translation", async () => {
  let called;
  globalThis.fetch = async (url, options) => { called = { url, options }; return new Response(JSON.stringify(ready), { headers: { "content-type": "application/json" } }); };
  assert.equal((await getSheetTranslation("document-id", 2, new AbortController().signal)).translated_text, "المينا");
  assert.match(called.url, /catalog\/documents\/document-id\/translation\?page=2$/);
  assert.equal(called.options.method, "GET"); assert.equal(called.options.credentials, "include"); assert.equal(called.options.body, undefined);
});

test("missing uploads are explicit, without generated/pending results", () => {
  assert.equal(parseTranslation({ ...ready, status: "unavailable", translated_text: "" }, 2).status, "unavailable");
  assert.throws(() => parseTranslation({ ...ready, status: "pending" }, 2));
});

test("admin saves to the selected edition with session and CSRF", async () => {
  const source = { file_id: "pdf-1", checksum: "a".repeat(64), page_count: 3, pages: [] }; let write;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith("/auth/csrf")) return new Response(JSON.stringify({ csrf_token: "csrf-test" }), { headers: { "content-type": "application/json" } });
    write = { url, options }; return new Response(JSON.stringify(source), { headers: { "content-type": "application/json" } });
  };
  const body = { file_id: source.file_id, checksum: source.checksum, pages: [{ page: 2, text: "الترجمة كاملة", expected_revision: 0 }] };
  await sheetTranslationAdminApi.save("sheet-1", "lockin", body);
  assert.match(write.url, /operations\/admin\/content\/sheets\/sheet-1\/translations\?edition=lockin$/);
  assert.equal(write.options.method, "PUT"); assert.equal(write.options.credentials, "include");
  assert.deepEqual(JSON.parse(write.options.body), body); assert.equal(new Headers(write.options.headers).get("X-CSRFToken"), "csrf-test");
});
