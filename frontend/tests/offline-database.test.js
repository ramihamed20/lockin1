import assert from "node:assert/strict";
import test from "node:test";
import { installOfflineEnvironment } from "./helpers/offlineEnvironment.js";

const env = installOfflineEnvironment();
const { offlineDatabase } = await import("../src/offline/database.js");
const { listOperations } = await import("../src/offline/queue.js");
const { offlineDownloadStats } = await import("../src/offline/downloads.js");
let opens = 0;
const open = env.indexedDB.open.bind(env.indexedDB);
env.indexedDB.open = (...args) => { opens += 1; return open(...args); };

test("batched reads preserve key order, missing records and account isolation", async () => {
  await offlineDatabase.putMany("reader-one", [["a", { value: 1 }], ["b", { value: 2 }]]);
  await offlineDatabase.put("reader-two", "a", { value: 3 });
  opens = 0;
  assert.deepEqual(await offlineDatabase.getMany("reader-one", ["b", "missing", "a", "b"]),
    [{ value: 2 }, undefined, { value: 1 }, { value: 2 }]);
  assert.equal(opens, 1);
  assert.deepEqual(await offlineDatabase.getMany("reader-two", ["a", "b"]), [{ value: 3 }, undefined]);
  opens = 0;
  assert.deepEqual(await offlineDatabase.getMany("reader-one", []), []);
  assert.equal(opens, 0);
});

test("listing queued work keeps sequence and time ordering with two database opens", async () => {
  const operations = [
    { operation_id: "c", client_sequence: 2, local_created_at: "2026-10-05" },
    { operation_id: "b", client_sequence: 1, local_created_at: "2026-10-05" },
    { operation_id: "a", client_sequence: 1, local_created_at: "2026-10-04" }
  ];
  await offlineDatabase.putMany("queue-reader", operations.map(value => [`operation:${value.operation_id}`, value]));
  await offlineDatabase.put("queue-reader", "profile", { name: "unrelated" });
  opens = 0;
  assert.deepEqual(await listOperations("queue-reader"), [operations[2], operations[1], operations[0]]);
  assert.equal(opens, 2);
});

test("download stats exclude absent content and preserve totals and account boundaries", async () => {
  const present = { id: "present", type: "active_study", checksum: "v1", storedSize: 120 };
  const absent = { id: "absent", type: "active_study", checksum: "v1", storedSize: 500 };
  await offlineDatabase.putMany("download-reader", [
    ["download:present", present], ["download:absent", absent], ["content:present:v1", { sheet_id: "test" }]
  ]);
  await offlineDatabase.put("other-reader", "content:absent:v1", { sheet_id: "test" });
  opens = 0;
  assert.deepEqual(await offlineDownloadStats("download-reader"), { items: [present], count: 1, bytes: 120 });
  assert.equal(opens, 4, "two metadata reads and the existing two content checks");
});
