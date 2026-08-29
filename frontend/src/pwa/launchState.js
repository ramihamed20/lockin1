export const FINAL_PWA_LAUNCH_STATES = new Set(["installed", "dismissed", "ready"]);

export function resolvePwaLaunchState({
  standalone,
  installedMemory,
  dismissed,
  serviceWorkerStatus,
  documentReady,
  promptAvailable,
  ios,
  android,
  touch
}) {
  if (standalone || installedMemory) return "installed";
  if (dismissed) return "dismissed";
  if (serviceWorkerStatus === "error") return "error";
  if (serviceWorkerStatus === "checking" || !documentReady) return "checking";
  if (promptAvailable) return "installable";
  if (ios) return "ios-instructions";
  if (android) return "manual-install";
  if (touch) return "unsupported";
  return "ready";
}

