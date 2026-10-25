/** A non-secret device/account binding, shared with the service worker. */
function database() {
  return new Promise((resolve, reject) => {
    const open = globalThis.indexedDB.open("lock-in-push-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("state");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
}

export async function readPushBinding() {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const read = db.transaction("state", "readonly").objectStore("state").get("binding");
      read.onsuccess = () => resolve(read.result || null);
      read.onerror = () => reject(read.error);
    });
  } finally { db.close(); }
}

export async function writePushBinding(value, expectedOwner = "", assertCurrent = () => {}) {
  const db = await database();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      const store = tx.objectStore("state");
      let complete = false;
      let checked = false;
      const finish = () => { if (complete && checked) resolve(undefined); };
      const read = store.get("binding");
      read.onsuccess = () => {
        try {
          // Fence the actual write, after opening storage, rather than only
          // checking the account before starting an asynchronous operation.
          assertCurrent();
          if (!expectedOwner || read.result?.userId === expectedOwner) {
            if (value) store.put(value, "binding");
            else store.delete("binding");
          }
          checked = true;
          finish();
        } catch (error) { reject(error); }
      };
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => { complete = true; finish(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export function clearPushBinding(userId) {
  return writePushBinding(null, userId);
}
