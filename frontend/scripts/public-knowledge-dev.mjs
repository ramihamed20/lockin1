import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Vite serves public files by filename, but its SPA fallback treats /help/
// as an app URL instead of public/help/index.html. Handle only the published
// allowlist before that fallback so opening a guide never boots account auth.
export function publicKnowledgeInDevelopment() {
  return {
    name: "lock-in-public-knowledge-in-development",
    configureServer(server) {
      const publicRoot = server.config.publicDir;
      const manifest = resolve(publicRoot, "public-search-routes.json");
      // Pages are added while the server runs (regenerating the public pages),
      // so the allowlist follows the manifest instead of the one read at startup;
      // otherwise a new page falls through to the app and opens the dashboard.
      let loadedAt = -1;
      let pages = new Map();
      let redirects = new Map();
      const current = () => {
        const modified = statSync(manifest).mtimeMs;
        if (modified === loadedAt) return;
        const nextPages = new Map();
        const nextRedirects = new Map();
        for (const route of JSON.parse(readFileSync(manifest, "utf8"))) {
          if (!/^\/(?:[a-z0-9-]+\/)+$/.test(route)) throw new Error("Invalid published public route.");
          nextPages.set(route, resolve(publicRoot, route.slice(1), "index.html"));
          nextRedirects.set(route.slice(0, -1), route);
          nextRedirects.set(route + "index.html", route);
        }
        pages = nextPages;
        redirects = nextRedirects;
        loadedAt = modified;
      };
      current();
      server.middlewares.use((request, response, next) => {
        if (!["GET", "HEAD"].includes(request.method)) return next();
        current();
        const pathname = new URL(request.url || "/", "http://vite.local").pathname;
        const canonical = redirects.get(pathname);
        if (canonical) {
          response.statusCode = 308;
          response.setHeader("Location", canonical);
          return response.end();
        }
        const file = pages.get(pathname);
        if (!file) return next();
        response.setHeader("Cache-Control", "no-store");
        try {
          const html = readFileSync(file);
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.setHeader("X-Robots-Tag", "index, follow, max-image-preview:large");
          response.end(request.method === "HEAD" ? undefined : html);
        } catch (error) {
          if (!["ENOENT", "ENOTDIR"].includes(error.code)) return next(error);
          response.statusCode = 404;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.setHeader("X-Robots-Tag", "noindex, nofollow");
          response.end(request.method === "HEAD" ? undefined : "Public page unavailable.");
        }
      });
    }
  };
}
