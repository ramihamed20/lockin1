/** Account-scoped IndexedDB records. No session secret is stored here. */
const PREFIX = "lock-in-offline-v1-";
const STORE = "records";

function open(userId) {
  if (!userId || typeof indexedDB === "undefined") return Promise.reject(new Error("Offline storage is unavailable."));
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(`${PREFIX}${userId}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function transact(userId, mode, action, readResult = (request) => request.result) {
  const db = await open(userId);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const result = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(readResult(result));
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const offlineDatabase = {
  get: (userId, key) => transact(userId, "readonly", (store) => store.get(key)),
  getMany: (userId, keys) => keys.length ? transact(userId, "readonly",
    (store) => keys.map((key) => store.get(key)),
    (requests) => requests.map((request) => request.result)) : Promise.resolve([]),
  put: (userId, key, value) => transact(userId, "readwrite", (store) => store.put(value, key)),
  // Check after opening the connection, immediately before the transaction's
  // write. Logout cleanup then either runs after this write or fences it out.
  putScoped: (userId, key, value, assertCurrent) => transact(userId, "readwrite", (store) => {
    assertCurrent();
    return store.put(value, key);
  }),
  putManyScoped: (userId, entries, assertCurrent) => transact(userId, "readwrite", (store) => {
    assertCurrent();
    let request;
    for (const [key, value] of entries) request = store.put(value, key);
    return request;
  }),
  putMany: (userId, entries) => transact(userId, "readwrite", (store) => {
    let request;
    for (const [key, value] of entries) request = store.put(value, key);
    return request;
  }),
  delete: (userId, key) => transact(userId, "readwrite", (store) => store.delete(key)),
  deleteScoped: (userId, key, assertCurrent) => transact(userId, "readwrite", (store) => {
    assertCurrent();
    return store.delete(key);
  }),
  // Read/compare/write in one transaction, including browsers without Web Locks.
  async updateScoped(userId, key, update, assertCurrent) {
    const db = await open(userId);
    try {
      return await new Promise((resolve, reject) => {
        let value, failure;
        const transaction = db.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        const read = store.get(key);
        read.onsuccess = () => {
          try {
            assertCurrent();
            value = update(read.result);
            if (value === undefined) store.delete(key);
            else store.put(value, key);
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = () => reject(failure || transaction.error);
        transaction.onabort = () => reject(failure || transaction.error);
      });
    } finally { db.close(); }
  },
  /** Atomic record + durable sync intent, both fenced to the initiating login. */
  async updateEntriesScoped(userId, key, update, assertCurrent) {
    const db = await open(userId);
    try {
      return await new Promise((resolve, reject) => {
        let value, failure;
        const transaction = db.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        const read = store.get(key);
        read.onsuccess = () => {
          try {
            assertCurrent();
            const result = update(read.result);
            value = result.value;
            if (value === undefined) store.delete(key);
            else store.put(value, key);
            for (const [entryKey, entryValue] of result.entries) store.put(entryValue, entryKey);
          } catch (error) { failure = error; transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = () => reject(failure || transaction.error);
        transaction.onabort = () => reject(failure || transaction.error);
      });
    } finally { db.close(); }
  },
  keys: (userId) => transact(userId, "readonly", (store) => store.getAllKeys()),
  clear: (userId) => transact(userId, "readwrite", (store) => store.clear())
};
