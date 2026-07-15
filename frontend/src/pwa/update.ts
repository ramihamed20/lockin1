import { useSyncExternalStore } from "react";
import { registerSW } from "virtual:pwa-register";

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;
type UpdateGuard = () => boolean;

type PwaState = Readonly<{
  offlineReady: boolean;
  updateAvailable: boolean;
}>;

let state: PwaState = { offlineReady: false, updateAvailable: false };
let updateServiceWorker: UpdateServiceWorker | null = null;
let initialized = false;
const listeners = new Set<() => void>();
const updateGuards = new Set<UpdateGuard>();

function setState(next: Partial<PwaState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PwaState {
  return state;
}

export function initializePwa(): void {
  if (initialized || !("serviceWorker" in navigator)) {
    return;
  }
  initialized = true;
  updateServiceWorker = registerSW({
    immediate: true,
    onOfflineReady: () => setState({ offlineReady: true }),
    onNeedRefresh: () => setState({ updateAvailable: true })
  });
}

export function registerPwaUpdateGuard(guard: UpdateGuard): () => void {
  updateGuards.add(guard);
  return () => updateGuards.delete(guard);
}

export async function applyPwaUpdate(): Promise<boolean> {
  if (!updateServiceWorker || [...updateGuards].some((guard) => !guard())) {
    return false;
  }
  await updateServiceWorker(true);
  return true;
}

export function usePwaStatus(): PwaState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
