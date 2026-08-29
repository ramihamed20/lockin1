const DISMISSAL_KEY = "lock-in.pwa-launch.dismissed-at";
const INSTALLED_KEY = "lock-in.pwa.installed-at";
export const PWA_DISMISSAL_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

function browserWindow() {
  return typeof window === "undefined" ? null : window;
}

function browserNavigator() {
  return typeof navigator === "undefined" ? null : navigator;
}

function browserStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {Window | null} [windowObject]
 * @param {Navigator | null} [navigatorObject]
 */
export function isStandalone(windowObject = browserWindow(), navigatorObject = browserNavigator()) {
  const displayMode = Boolean(windowObject?.matchMedia?.("(display-mode: standalone)")?.matches);
  const iosStandalone = Boolean(/** @type {Navigator & {standalone?: boolean} | null} */ (navigatorObject)?.standalone);
  return displayMode || iosStandalone;
}

/** @param {Navigator | null} [navigatorObject] */
export function isIOS(navigatorObject = browserNavigator()) {
  const userAgent = navigatorObject?.userAgent || "";
  const platform = navigatorObject?.platform || "";
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (platform === "MacIntel" && Number(navigatorObject?.maxTouchPoints || 0) > 1);
}

/** @param {Navigator | null} [navigatorObject] */
export function isAndroid(navigatorObject = browserNavigator()) {
  return /Android/i.test(navigatorObject?.userAgent || "");
}

/**
 * Touch capability is the primary tablet signal. User-agent checks are used
 * only to select platform-specific instructions after touch support is known.
 * @param {Window | null} [windowObject]
 * @param {Navigator | null} [navigatorObject]
 */
export function isTouchDevice(windowObject = browserWindow(), navigatorObject = browserNavigator()) {
  return Number(navigatorObject?.maxTouchPoints || 0) > 0
    || Boolean(windowObject?.matchMedia?.("(pointer: coarse)")?.matches)
    || Boolean(windowObject && "ontouchstart" in windowObject);
}

/** @param {Navigator | null} [navigatorObject] */
export function isSafari(navigatorObject = browserNavigator()) {
  const userAgent = navigatorObject?.userAgent || "";
  return /Safari/i.test(userAgent) && !/(CriOS|FxiOS|EdgiOS|OPiOS|SamsungBrowser)/i.test(userAgent);
}

export function detectPwaPlatform() {
  const windowObject = browserWindow();
  const navigatorObject = browserNavigator();
  return {
    standalone: isStandalone(windowObject, navigatorObject),
    ios: isIOS(navigatorObject),
    android: isAndroid(navigatorObject),
    touch: isTouchDevice(windowObject, navigatorObject),
    safari: isSafari(navigatorObject)
  };
}

/**
 * @param {string} key
 * @param {number} maxAge
 * @param {number} now
 * @param {Storage | null} storage
 */
function hasRecentTimestamp(key, maxAge, now, storage) {
  try {
    const timestamp = Number(storage?.getItem(key) || 0);
    return timestamp > 0 && now - timestamp >= 0 && now - timestamp < maxAge;
  } catch {
    return false;
  }
}

export function hasActivePwaDismissal(now = Date.now(), storage = browserStorage()) {
  return hasRecentTimestamp(DISMISSAL_KEY, PWA_DISMISSAL_COOLDOWN_MS, now, storage);
}

export function hasInstalledPwaMemory(now = Date.now(), storage = browserStorage()) {
  try {
    const timestamp = Number(storage?.getItem(INSTALLED_KEY) || 0);
    return timestamp > 0 && timestamp <= now;
  } catch {
    return false;
  }
}

export function rememberPwaDismissal(now = Date.now(), storage = browserStorage()) {
  try {
    storage?.setItem(DISMISSAL_KEY, String(now));
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}

export function clearPwaDismissal(storage = browserStorage()) {
  try {
    storage?.removeItem(DISMISSAL_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}

export function rememberPwaInstalled(now = Date.now(), storage = browserStorage()) {
  try {
    storage?.setItem(INSTALLED_KEY, String(now));
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}

export function clearPwaInstalledMemory(storage = browserStorage()) {
  try {
    storage?.removeItem(INSTALLED_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browsers.
  }
}
