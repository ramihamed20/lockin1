import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers";
import { createAnnotationStore } from "../src/workspace/storage/annotationStore.js";

function storageFixture() {
  const requests = [];
  const transactions = [];
  let closes = 0;
  const database = {
    close() { closes += 1; },
    transaction() {
      const transaction = {
        objectStore() { return { get() { const request = {}; transaction.read = request; return request; }, put(value) { transaction.saved = value; } }; }
      };
      transactions.push(transaction);
      return transaction;
    }
  };
  const store = createAnnotationStore({ indexedDB: { open() { const request = { result: database }; requests.push(request); return request; } }, localStorage: {} });
  return { store, requests, transactions, database, closes: () => closes };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("closing a reader during an IndexedDB open releases the late connection", async () => {
  const fixture = storageFixture();
  const opening = fixture.store.open();
  fixture.store.close();
  fixture.requests[0].onsuccess();
  await opening;
  await tick();
  assert.equal(fixture.closes(), 1);
  assert.equal(fixture.database.onversionchange, null);
});

test("reader close drains a pending hydration transaction", async () => {
  const fixture = storageFixture();
  const reading = fixture.store.readDocument({ owner: "a", materialSlug: "m", sheetSlug: "s" });
  fixture.store.close();
  fixture.requests[0].onsuccess();
  await tick();
  assert.equal(fixture.closes(), 0);
  const transaction = fixture.transactions[0];
  transaction.read.result = null;
  transaction.read.onsuccess();
  await tick();
  assert.equal(fixture.closes(), 0);
  transaction.oncomplete();
  assert.equal(await reading, null);
  await tick();
  assert.equal(fixture.closes(), 1);
});

test("reader close waits for the final annotation write to commit", async () => {
  const fixture = storageFixture();
  const writing = fixture.store.writeDocument({ owner: "a", materialSlug: "m", sheetSlug: "s", view: {}, notes: [], pages: new Map(), savedAt: "2026-10-05" });
  fixture.requests[0].onsuccess();
  await tick();
  fixture.store.close();
  assert.equal(fixture.closes(), 0);
  assert.equal(fixture.transactions[0].saved.owner, "a");
  fixture.transactions[0].oncomplete();
  assert.deepEqual(await writing, { savedAt: "2026-10-05" });
  await tick();
  assert.equal(fixture.closes(), 1);
});

test("a blocked open that succeeds after fallback closes its unowned database", async () => {
  const fixture = storageFixture();
  const opening = fixture.store.open();
  fixture.requests[0].onblocked();
  await assert.rejects(opening, { code: "blocked" });
  fixture.requests[0].onsuccess();
  assert.equal(fixture.closes(), 1);
});
