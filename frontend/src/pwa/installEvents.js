import { clearPwaInstalledMemory, isStandalone } from "./platform.js";

const subscribers = new Set();
let snapshot = {
  prompt: null,
  installed: isStandalone(),
  lastChoice: null,
  version: 0
};

export function pwaDebug(message, details = undefined) {
  if (!import.meta.env?.DEV) return;
  if (details === undefined) console.info(`[PWA] ${message}`);
  else console.info(`[PWA] ${message}`, details);
}

function publish(next) {
  snapshot = { ...snapshot, ...next, version: snapshot.version + 1 };
  subscribers.forEach((subscriber) => subscriber());
}

/** @param {() => void} subscriber */
export function subscribeToInstallEvents(subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function getInstallSnapshot() {
  return snapshot;
}

export function canPromptInstall() {
  return Boolean(snapshot.prompt);
}

export async function promptForPwaInstall() {
  const installPrompt = snapshot.prompt;
  if (!installPrompt) throw new Error("The browser install prompt is no longer available.");

  pwaDebug("Opening the browser-owned install prompt");
  await installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  pwaDebug("Install choice", choice?.outcome || "unknown");
  if (snapshot.prompt === installPrompt) {
    publish({ prompt: null, lastChoice: choice?.outcome || "unknown" });
  }
  return choice;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    // This browser-owned event is stronger evidence than our local install
    // memory: it can re-enable onboarding after the user uninstalls the PWA.
    clearPwaInstalledMemory();
    pwaDebug("beforeinstallprompt received");
    publish({ prompt: event, installed: false, lastChoice: null });
  });

  window.addEventListener("appinstalled", () => {
    pwaDebug("appinstalled fired");
    publish({ prompt: null, installed: true, lastChoice: "accepted" });
  });

  const standaloneQuery = window.matchMedia?.("(display-mode: standalone)");
  standaloneQuery?.addEventListener?.("change", (event) => {
    if (event.matches) publish({ prompt: null, installed: true });
  });
}
