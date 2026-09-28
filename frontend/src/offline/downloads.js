import { API_BASE_PATH, request } from "../api/client.js";
import { offlineDatabase } from "./database.js";
import { offlineAccessStatus } from "./lease.js";

const cacheName = (userId) => `lock-in-private-offline-v1-${userId}`;
const cacheKey = (userId, itemId) => new URL(`/__lockin_offline__/${encodeURIComponent(userId)}/${encodeURIComponent(itemId)}`, globalThis.location.origin).href;
// Content kept in IndexedDB rather than Cache Storage: small JSON bundles that
// include answer keys, which must never sit in a cache a URL could address.
const JSON_TYPES = new Set(["questions", "active_study"]);

export async function fetchOfflineManifest(userId) {
  const manifest = await request("/offline/manifest/");
  if (!Array.isArray(manifest?.items) || !Array.isArray(manifest?.subjects)) throw new Error("Invalid offline manifest.");
  await offlineDatabase.put(userId, "manifest", { ...manifest, fetched_at: new Date().toISOString() });
  return manifest;
}

export async function readOfflineManifest(userId) {
  return offlineDatabase.get(userId, "manifest");
}

export async function readDownloadMetadata(userId, itemId) {
  return offlineDatabase.get(userId, `download:${itemId}`);
}

/**
 * The item and everything it needs, dependencies first. An unknown or cyclic
 * dependency makes the graph unusable rather than silently shorter.
 * @param {{ items?: any[] } | null | undefined} manifest
 * @param {any} item
 */
export function dependencyGraph(manifest, item) {
  const index = new Map((manifest?.items || []).map((entry) => [entry.id, entry]));
  const ordered = [];
  const visiting = new Set();
  const done = new Set();
  const visit = (entry) => {
    if (done.has(entry.id)) return;
    if (visiting.has(entry.id)) throw new Error("This download has a circular dependency.");
    visiting.add(entry.id);
    for (const id of entry.dependencies || []) {
      const dependency = index.get(id);
      if (!dependency?.available) throw new Error("A required part of this download is unavailable.");
      visit(dependency);
    }
    visiting.delete(entry.id);
    done.add(entry.id);
    ordered.push(entry);
  };
  visit(item);
  return ordered;
}

async function isOwnContentStored(userId, item) {
  const metadata = await readDownloadMetadata(userId, item.id);
  if (metadata?.checksum !== item.checksum || metadata?.version !== item.version) return false;
  if (JSON_TYPES.has(item.type)) return Boolean(await offlineDatabase.get(userId, `content:${item.id}:${item.checksum}`));
  return Boolean(await (await caches.open(cacheName(userId))).match(cacheKey(userId, item.id)));
}

/**
 * True only when this exact version and every dependency's exact version are
 * stored. A bundle whose PDF failed or changed is not offline ready.
 */
export async function isOfflineItemStored(userId, item, manifest = null) {
  const graph = dependencyGraph(manifest || await readOfflineManifest(userId) || { items: [item] }, item);
  for (const entry of graph) if (!(await isOwnContentStored(userId, entry))) return false;
  return true;
}

/**
 * "downloaded": this version and its dependencies are stored.
 * "update": an older version is stored; the student can keep using it.
 * "incomplete": part of the bundle is stored; it is not offline ready.
 * "download": nothing is stored yet.
 */
export async function offlineItemState(userId, item, manifest = null) {
  let graph;
  try {
    graph = dependencyGraph(manifest || await readOfflineManifest(userId) || { items: [item] }, item);
  } catch {
    return "unavailable";
  }
  const stored = await Promise.all(graph.map((entry) => isOwnContentStored(userId, entry)));
  if (stored.every(Boolean)) return "downloaded";
  const metadata = await Promise.all(graph.map((entry) => readDownloadMetadata(userId, entry.id)));
  if (metadata.every(Boolean)) return "update";
  return metadata.some(Boolean) || stored.some(Boolean) ? "incomplete" : "download";
}

async function sha256(blob) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function jsonSize(value) {
  return new globalThis.TextEncoder().encode(JSON.stringify(value)).length;
}

/** Keeps exactly one stored version of a JSON bundle. */
async function storeJsonContent(userId, item, bundle) {
  const metadata = { ...item, downloadedAt: new Date().toISOString(), storedSize: jsonSize(bundle) };
  await offlineDatabase.putMany(userId, [
    [`content:${item.id}:${item.checksum}`, bundle],
    [`download:${item.id}`, metadata]
  ]);
  for (const key of await offlineDatabase.keys(userId)) {
    const text = String(key);
    if (text.startsWith(`content:${item.id}:`) && text !== `content:${item.id}:${item.checksum}`) await offlineDatabase.delete(userId, key);
  }
  return metadata;
}

export function validActiveStudyBundle(bundle, item) {
  if (!bundle || bundle.content_version !== item.checksum || bundle.sheet_id !== item.sheet_id || bundle.edition !== item.edition) return false;
  if (!Number.isInteger(bundle.rules?.checkpoint_pass) || !Number.isInteger(bundle.rules?.final_pass)) return false;
  const difficulties = Object.values(bundle.difficulties || {});
  if (!difficulties.length || !Array.isArray(bundle.availability?.difficulties)) return false;
  const complete = (question) => question && typeof question.question === "string" && question.options
    && typeof question.correct_answer === "string" && question.correct_answer in question.options;
  return difficulties.every((difficulty) => Array.isArray(difficulty.page_ranges)
    && Array.isArray(difficulty.parts)
    && difficulty.parts.length === difficulty.number_of_parts
    && difficulty.page_ranges.length === difficulty.number_of_parts
    && difficulty.parts.every((part) => Array.isArray(part.questions) && part.questions.length > 0 && part.questions.every(complete))
    && Array.isArray(difficulty.final_exam?.questions) && difficulty.final_exam.questions.length > 0
    && difficulty.final_exam.questions.every(complete));
}

// Anchored paths with one identifier segment: no "/" or "." can reach it.
async function downloadJson(userId, item) {
  if (item.type === "questions") {
    if (!/^\/api\/v1\/offline\/questions\/[\w-]+\/\?source=(exam|ai-sheet)$/i.test(item.download_url)) throw new Error("Invalid question download.");
    const bundle = await request(item.download_url.slice(API_BASE_PATH.length));
    if (bundle?.content_version !== item.checksum || !Array.isArray(bundle.results) || bundle.results.length !== bundle.count || !bundle.answer_keys ||
        bundle.results.some((question) => !Array.isArray(bundle.answer_keys[question.id]?.correct_choice_ids))) throw new Error("Question download is incomplete.");
    return storeJsonContent(userId, item, bundle);
  }
  if (!/^\/api\/v1\/offline\/active-study\/[\w-]+\/\?edition=(university|lockin)$/i.test(item.download_url)) throw new Error("Invalid Active Study download.");
  const bundle = await request(item.download_url.slice(API_BASE_PATH.length));
  if (!validActiveStudyBundle(bundle, item)) throw new Error("The Active Study download is incomplete.");
  const metadata = await storeJsonContent(userId, item, bundle);
  // Seeds this device's progress from the server. Progress this device made
  // itself is never overwritten here.
  const { seedActiveStudyRuns } = await import("./activeStudy.js");
  await seedActiveStudyRuns(userId, bundle).catch(() => undefined);
  return metadata;
}

async function downloadFile(userId, item, onProgress) {
  if (!item.download_url.startsWith(`${API_BASE_PATH}/files/`)) throw new Error("Invalid download item.");
  const response = await fetch(item.download_url, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error("Download failed.");
  const total = Number(response.headers.get("Content-Length")) || item.size;
  const chunks = [];
  let received = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress(total > 0 ? Math.min(1, received / total) : 0);
    }
  } else {
    const bytes = await response.arrayBuffer();
    chunks.push(bytes);
    received = bytes.byteLength;
  }
  const blob = new Blob(chunks, { type: response.headers.get("Content-Type") || "application/pdf" });
  if ((item.size && received !== item.size) || (item.checksum && await sha256(blob) !== item.checksum.toLowerCase())) {
    throw new Error("Download integrity check failed.");
  }
  const cache = await caches.open(cacheName(userId));
  const key = cacheKey(userId, item.id);
  await cache.put(key, new Response(blob, { headers: { "Content-Type": blob.type, "Content-Length": String(received) } }));
  const metadata = { ...item, downloadedAt: new Date().toISOString(), storedSize: received };
  try {
    await offlineDatabase.put(userId, `download:${item.id}`, metadata);
  } catch (error) {
    await cache.delete(key);
    throw error;
  }
  return metadata;
}

async function downloadOne(userId, item, onProgress) {
  if (!item?.available || typeof item.download_url !== "string") throw new Error("Invalid download item.");
  if (await isOwnContentStored(userId, item)) return readDownloadMetadata(userId, item.id);
  if (item.size && navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate().catch(() => null);
    if (estimate?.quota && estimate.usage && estimate.quota - estimate.usage < item.size * 1.1) {
      throw new Error("This device is low on storage. Remove a download and try again.");
    }
  }
  const metadata = JSON_TYPES.has(item.type) ? await downloadJson(userId, item) : await downloadFile(userId, item, onProgress);
  onProgress(1);
  return metadata;
}

/**
 * Downloads an item after everything it depends on. Each part is verified and
 * stored on its own, so a retry fetches only what is still missing, and the
 * item is reported offline ready only once the whole graph is stored.
 * @param {string} userId
 * @param {any} item
 * @param {(progress: number) => void} [onProgress]
 * @param {{ manual?: boolean, manifest?: any }} [options]
 */
export async function downloadOfflineItem(userId, item, onProgress = () => {}, { manual = false, manifest = null } = {}) {
  const graph = dependencyGraph(manifest || await readOfflineManifest(userId) || { items: [item] }, item);
  if (manual && navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
  let metadata = null;
  for (let index = 0; index < graph.length; index += 1) {
    metadata = await downloadOne(userId, graph[index], (progress) => onProgress((index + progress) / graph.length));
  }
  onProgress(1);
  return metadata;
}

export async function getOfflineBlob(userId, itemId) {
  if (!(await offlineAccessStatus(userId)).available) return null;
  const current = (await readOfflineManifest(userId))?.items?.find((item) => item.id === itemId && item.available);
  if (!current || !(await isOwnContentStored(userId, current))) return null;
  const cache = await caches.open(cacheName(userId));
  return (await cache.match(cacheKey(userId, itemId)))?.blob() || null;
}

/** Removes downloaded content only. Progress and unsynced work stay on the device. */
export async function removeOfflineItem(userId, itemId) {
  const cache = await caches.open(cacheName(userId));
  await cache.delete(cacheKey(userId, itemId));
  await offlineDatabase.delete(userId, `download:${itemId}`);
  for (const key of await offlineDatabase.keys(userId)) {
    if (String(key).startsWith(`content:${itemId}:`)) await offlineDatabase.delete(userId, key);
  }
}

export async function clearOfflineDownloads(userId) {
  await caches.delete(cacheName(userId));
  for (const key of await offlineDatabase.keys(userId)) {
    if (String(key).startsWith("download:") || String(key).startsWith("content:")) await offlineDatabase.delete(userId, key);
  }
}

export async function offlineDownloadStats(userId) {
  const keys = (await offlineDatabase.keys(userId)).filter((key) => String(key).startsWith("download:"));
  const records = (await Promise.all(keys.map((key) => offlineDatabase.get(userId, key)))).filter(Boolean);
  const cache = await caches.open(cacheName(userId));
  const items = (await Promise.all(records.map(async (item) => {
    const present = JSON_TYPES.has(item.type)
      ? Boolean(await offlineDatabase.get(userId, `content:${item.id}:${item.checksum}`))
      : Boolean(await cache.match(cacheKey(userId, item.id)));
    return present ? item : null;
  }))).filter(Boolean);
  return { items, count: items.length, bytes: items.reduce((sum, item) => sum + (item.storedSize || 0), 0) };
}

export function mayAutoDownload(networkPreference) {
  if (networkPreference !== "wifi") return true;
  const networkNavigator = /** @type {Navigator & {connection?: {type?: string}, mozConnection?: {type?: string}, webkitConnection?: {type?: string}}} */ (navigator);
  const connection = networkNavigator.connection || networkNavigator.mozConnection || networkNavigator.webkitConnection;
  // Network Information is absent on Safari. An unknown network must not silently
  // disable an opted-in feature; manual downloads remain available everywhere.
  return !connection?.type || connection.type === "wifi" || connection.type === "ethernet";
}

async function storedBundle(userId, id) {
  if (!(await offlineAccessStatus(userId)).available) return null;
  const manifest = await readOfflineManifest(userId);
  const current = manifest?.items?.find((item) => item.id === id && item.available);
  if (current && await isOfflineItemStored(userId, current, manifest)) {
    return offlineDatabase.get(userId, `content:${id}:${current.checksum}`);
  }
  // A newer manifest can list a version not downloaded yet. The stored
  // version stays usable offline until the update arrives.
  const metadata = await readDownloadMetadata(userId, id);
  return metadata ? offlineDatabase.get(userId, `content:${id}:${metadata.checksum}`) : null;
}

export async function getOfflineQuestions(userId, sheetId, source) {
  return storedBundle(userId, `questions:${sheetId}:${source}`);
}

export async function getOfflineActiveStudy(userId, sheetId, edition = "university") {
  return storedBundle(userId, `active_study:${sheetId}:${edition || "university"}`);
}

/**
 * Everything one sheet edition needs offline: its PDF, its Active Study (with
 * that PDF as a dependency), its summary and the sheet's question banks.
 */
export function sheetEditionItems(manifest, { materialSlug, sheetSlug, edition }) {
  const items = manifest?.items || [];
  const pdf = items.find((entry) => entry.type === "sheet" && entry.material_slug === materialSlug && entry.sheet_slug === sheetSlug && entry.edition === edition);
  if (!pdf) return [];
  return items.filter((entry) => entry.available && (
    entry.id === pdf.id
    || (entry.sheet_id === pdf.sheet_id && entry.edition === edition && ["active_study", "summary"].includes(entry.type))
    || (entry.sheet_id === pdf.sheet_id && entry.type === "questions")
  ));
}
