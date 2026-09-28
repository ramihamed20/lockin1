/* global setImmediate, queueMicrotask, EventTarget */
/**
 * A browser-shaped environment for offline mode tests: an in-memory
 * IndexedDB and Cache Storage behind the real offline modules, a routed fetch,
 * and a signed Ed25519 lease. Data survives a simulated app restart because
 * it lives in these stores, exactly as it does in the installed PWA.
 */
import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";

const clone = (value) => (value === undefined ? undefined : globalThis.structuredClone(value));

function request() {
  return { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
}

function settle(fn) {
  const req = request();
  queueMicrotask(() => {
    try {
      req.result = fn();
      req.onsuccess?.({ target: req });
    } catch (error) {
      req.error = error;
      req.onerror?.({ target: req });
    }
  });
  return req;
}

function objectStore(store) {
  return {
    get: (key) => settle(() => clone(store.data.get(key))),
    put: (value, key) => settle(() => {
      const id = key ?? value[store.keyPath];
      store.data.set(id, clone(value));
      return id;
    }),
    delete: (key) => settle(() => { store.data.delete(key); }),
    getAllKeys: () => settle(() => [...store.data.keys()]),
    clear: () => settle(() => { store.data.clear(); }),
    createIndex(name, path) { store.indexes.set(name, path); },
    index: (name) => ({
      getAll: (value) => settle(() => [...store.data.values()].filter((item) => item[store.indexes.get(name)] === value).map(clone))
    })
  };
}

export function createFakeIndexedDB() {
  const databases = new Map();
  return {
    databases,
    open(name, version = 1) {
      const req = request();
      queueMicrotask(() => {
        let database = databases.get(name);
        const upgrade = !database || version > database.version;
        if (!database) {
          database = { version: 0, stores: new Map() };
          databases.set(name, database);
        }
        const connection = {
          objectStoreNames: { contains: (store) => database.stores.has(store) },
          createObjectStore(store, options = {}) {
            const created = { data: new Map(), keyPath: options.keyPath, indexes: new Map() };
            database.stores.set(store, created);
            return objectStore(created);
          },
          transaction() {
            const transaction = {
              oncomplete: null, onerror: null, onabort: null, error: null,
              objectStore: (store) => objectStore(database.stores.get(store))
            };
            setImmediate(() => transaction.oncomplete?.());
            return transaction;
          },
          close() {},
          onversionchange: null
        };
        req.result = connection;
        if (upgrade) {
          database.version = version;
          req.onupgradeneeded?.({ target: req });
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    }
  };
}

export function createFakeCaches() {
  const caches = new Map();
  const open = async (name) => {
    if (!caches.has(name)) {
      const entries = new Map();
      caches.set(name, {
        entries,
        async put(key, response) {
          entries.set(String(key), { body: Buffer.from(await response.arrayBuffer()), headers: [...response.headers] });
        },
        async match(key) {
          const entry = entries.get(String(key));
          return entry ? new Response(entry.body, { headers: entry.headers }) : undefined;
        },
        async delete(key) { return entries.delete(String(key)); },
        async keys() { return [...entries.keys()]; }
      });
    }
    return caches.get(name);
  };
  return { caches, open, delete: async (name) => caches.delete(name), keys: async () => [...caches.keys()] };
}

export function signedLease({ userId, iat = Math.floor(Date.now() / 1000), exp = iat + 24 * 3600, subscriptionUntil = null } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "offline-lease+jwt" })).toString("base64url");
  const claims = { v: 1, sub: userId, user_id: userId, iat, exp, offline_until: exp, subscription_until: subscriptionUntil, jti: "test" };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign(null, Buffer.from(`${header}.${body}`), privateKey).toString("base64url");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  return { token: `${header}.${body}.${signature}`, public_key: raw, issued_at: new Date(iat * 1000).toISOString(), offline_until: new Date(exp * 1000).toISOString() };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/**
 * Installs the browser globals once. `routes` maps "METHOD /path" (API paths
 * without /api/v1, query included) to a handler; `offline()` makes every
 * request fail as a lost connection does.
 */
export function installOfflineEnvironment() {
  const events = new EventTarget();
  const windowLike = Object.assign(events, { location: { origin: "https://lockin.test" }, CustomEvent: globalThis.CustomEvent });
  const values = new Map();
  const env = {
    routes: new Map(),
    calls: [],
    online: true,
    indexedDB: createFakeIndexedDB(),
    caches: createFakeCaches(),
    json,
    goOffline() { env.online = false; globalThis.navigator.onLine = false; },
    goOnline() { env.online = true; globalThis.navigator.onLine = true; },
    route(key, handler) { env.routes.set(key, handler); }
  };
  globalThis.window = windowLike;
  globalThis.location = windowLike.location;
  globalThis.document = { cookie: "csrftoken=test-csrf", visibilityState: "visible", documentElement: { lang: "en" } };
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true, storage: null } });
  globalThis.indexedDB = env.indexedDB;
  globalThis.caches = env.caches;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(String(input), windowLike.location.origin);
    const method = (options.method || "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, "") + url.search;
    env.calls.push(`${method} ${path}`);
    if (!env.online) throw new TypeError("Failed to fetch");
    if (path === "/auth/csrf") return json({ csrf_token: "test-csrf" });
    // "METHOD /prefix*" matches any path, query included, that starts with the prefix.
    const handler = env.routes.get(`${method} ${path}`)
      || [...env.routes].find(([key]) => key.endsWith("*") && `${method} ${path}`.startsWith(key.slice(0, -1)))?.[1];
    if (!handler) return json({ error: { message: `No route for ${method} ${path}` } }, 404);
    const body = typeof options.body === "string" && options.body ? JSON.parse(options.body) : undefined;
    const result = await handler({ body, path, method });
    return result instanceof Response ? result : json(result);
  };
  return env;
}
