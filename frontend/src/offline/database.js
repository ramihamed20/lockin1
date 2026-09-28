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

async function transact(userId, mode, action) {
  const db = await open(userId);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const result = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(result.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const offlineDatabase = {
  get: (userId, key) => transact(userId, "readonly", (store) => store.get(key)),
  put: (userId, key, value) => transact(userId, "readwrite", (store) => store.put(value, key)),
  putMany: (userId, entries) => transact(userId, "readwrite", (store) => {
    let request;
    for (const [key, value] of entries) request = store.put(value, key);
    return request;
  }),
  delete: (userId, key) => transact(userId, "readwrite", (store) => store.delete(key)),
  keys: (userId) => transact(userId, "readonly", (store) => store.getAllKeys()),
  clear: (userId) => transact(userId, "readwrite", (store) => store.clear())
};
