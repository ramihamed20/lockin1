/* global __APP_VERSION__, __APP_SEMVER__, __APP_BUILD_TIME__ */
// What is running, in a form a reader can read back to support. All three
// values are compiled in by vite.config.js: the package version, the release
// identifier CI passes as VITE_APP_VERSION (the commit SHA), and the build
// time, so every production build shows a different "Build" even when the
// release identifier is reused.

const SHA_PATTERN = /^[0-9a-f]{12,40}$/i;

/**
 * @param {{ semver?: string, release?: string, builtAt?: string }} values
 */
export function describeBuild({ semver, release, builtAt } = {}) {
  const version = semver || "0.0.0";
  const releaseId = release || "development";
  const shortRelease = SHA_PATTERN.test(releaseId) ? releaseId.slice(0, 7) : releaseId;
  const date = /^\d{4}-\d{2}-\d{2}/.test(builtAt || "") ? builtAt.slice(0, 10).replaceAll("-", ".") : "";
  return {
    version,
    release: releaseId,
    builtAt: builtAt || "",
    build: date ? `${date}-${shortRelease}` : shortRelease
  };
}

export const BUILD_INFO = Object.freeze(describeBuild({
  semver: typeof __APP_SEMVER__ === "string" ? __APP_SEMVER__ : undefined,
  release: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : undefined,
  builtAt: typeof __APP_BUILD_TIME__ === "string" ? __APP_BUILD_TIME__ : undefined
}));
