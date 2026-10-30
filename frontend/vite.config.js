import { writePublicKnowledge } from "./scripts/build-public-knowledge.mjs";
import { publicKnowledgeInDevelopment } from "./scripts/public-knowledge-dev.mjs";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

function normalizeBasePath(value) {
  const basePath = String(value || "/").trim();
  if (!basePath.startsWith("/") || basePath.startsWith("//") || /[?#\\]/.test(basePath)) {
    throw new Error("VITE_BASE_PATH must be a same-origin absolute path without a query or hash.");
  }
  return basePath.endsWith("/") ? basePath : `${basePath}/`;
}

/**
 * A production PWA worker may still control localhost after switching back to
 * `vite dev`. Its precached HTML can then point at hashed chunks that the dev
 * server does not provide, which looks like a stale lazy-route deployment.
 *
 * Serve a one-shot replacement only from Vite's development server. Browser
 * update checks replace the old worker and unregister it. Existing clients
 * stay where they are: even development tooling must not turn backgrounding
 * the browser into an unsolicited navigation. Production never registers this
 * plugin and keeps the versioned Workbox worker below.
 */
function removeLegacyWorkerInDevelopment() {
  const worker = [
    "self.addEventListener('install', () => self.skipWaiting());",
    "self.addEventListener('activate', (event) => event.waitUntil((async () => {",
    "  await self.registration.unregister();",
    "})()));"
  ].join("\n");
  const legacyPaths = new Set(["/sw.js", "/service-worker.js"]);

  return {
    name: "lock-in-remove-legacy-worker-in-development",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://vite.local").pathname;
        if (!legacyPaths.has(pathname)) return next();
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(worker);
      });
    }
  };
}

/**
 * Publishes the release notes beside the app as release-notes.json, from the
 * same data the app bundles. A running (older) app fetches it to explain an
 * update before the reader installs it. The file is unhashed and outside the
 * precache, so it always reflects the newest deployment.
 */
function releaseNotesFile(release) {
  const body = JSON.stringify(release);
  return {
    name: "lock-in-release-notes",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (new URL(request.url || "/", "http://vite.local").pathname !== "/release-notes.json") return next();
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "release-notes.json", source: body });
    }
  };
}

/**
 * Ships each language as its own chunk. lib/i18n.js stays the one source (tests
 * and the public-knowledge evidence read it as written); in a production build
 * this plugin replaces its catalogue literal with the route names in English
 * -- routeMetadata compares a page's English title against them in every
 * language -- and serves `virtual:lockin-locale/<locale>` as that locale's
 * catalogue merged over English, which loadLocaleMessages() imports on demand.
 */
function localeChunks() {
  const prefix = "virtual:lockin-locale/";
  const source = new URL("./src/lib/i18n.js", import.meta.url);
  let catalogues;
  let building = false;
  async function catalogue(locale) {
    catalogues ??= await import(source.href);
    return catalogues.messageCatalog(locale);
  }
  return {
    name: "lock-in-locale-chunks",
    configResolved(config) {
      building = config.command === "build";
    },
    resolveId(id) {
      return id.startsWith(prefix) ? `\0${id}` : null;
    },
    async load(id) {
      if (!id.startsWith(`\0${prefix}`)) return null;
      const locale = id.slice(prefix.length + 1);
      // JSON.parse of a string literal is the quickest way for an engine to
      // read an object this size.
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(await catalogue(locale)))});`;
    },
    async transform(code, id) {
      if (!building || !id.replace(/\\/g, "/").endsWith("/src/lib/i18n.js")) return null;
      const routeSource = readFileSync(new URL("./src/lib/routeMetadata.js", import.meta.url), "utf8");
      const routeKeys = new Set(["route.notFound", ...[...routeSource.matchAll(/key: "([^"]+)"/g)].map((match) => match[1])]);
      const english = await catalogue("en");
      const routeNames = Object.fromEntries([...routeKeys].filter((key) => key in english).map((key) => [key, english[key]]));
      const literal = /const messages = \{[\s\S]*?\r?\n\};(?=\r?\n\r?\nexport function normalizeLocale)/;
      const loaded = "const loadedLocales = new Set(SUPPORTED_LOCALES);";
      if (!literal.test(code) || code.split(loaded).length !== 2) {
        this.error("lib/i18n.js no longer has the shape localeChunks rewrites; update the plugin.");
      }
      return {
        code: code
          .replace(loaded, "const loadedLocales = new Set();")
          .replace(literal, `const messages = { en: ${JSON.stringify(routeNames)}, ar: {} };`),
        map: null
      };
    }
  };
}

export default defineConfig(async ({ mode, command }) => {
  if (command === "build") writePublicKnowledge({ check: true });
  const env = loadEnv(mode, process.cwd(), "");
  // Only `npm run build:e2e` sets this; every other build compiles in null.
  // See e2e/fixtures/catalog.js.
  const e2eCatalogMaterials = process.env.LOCKIN_E2E_CATALOG === "1"
    ? (await import("./e2e/fixtures/catalog.js")).e2eCatalogMaterials()
    : null;
  const { WHATS_NEW } = await import("./src/lib/whatsNew.js");
  const appVersion = env.VITE_APP_VERSION || process.env.GITHUB_SHA || "local";
  // Shown in Settings so a stale deployment can be diagnosed. The package
  // version is the human release; the build time makes every production build
  // distinguishable even when a release identifier is rebuilt.
  const appSemver = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
  const buildTime = new Date().toISOString();
  const basePath = normalizeBasePath(env.VITE_BASE_PATH || "/");
  // This value is used only by Vite's development proxy. Browser requests stay
  // same-origin at /api/v1, so session cookies are never sent by the browser to
  // this target directly.
  const djangoProxyTarget = env.VITE_DJANGO_PROXY_TARGET || "http://127.0.0.1:8000";
  const djangoOrigin = new URL(djangoProxyTarget).origin;

  return {
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_SEMVER__: JSON.stringify(appSemver),
    __APP_BUILD_TIME__: JSON.stringify(buildTime),
    __E2E_CATALOG_MATERIALS__: JSON.stringify(e2eCatalogMaterials)
  },
  plugins: [
    react(),
    localeChunks(),
    releaseNotesFile(WHATS_NEW),
    publicKnowledgeInDevelopment(),
    ...(mode === "development" ? [removeLegacyWorkerInDevelopment()] : []),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      strategies: "injectManifest",
      srcDir: "src",
      filename: "service-worker.js",
      includeAssets: [
        "icons/*.svg",
        "icons/lockin-light-16-v3.png",
        "icons/lockin-light-32-v3.png",
        "icons/lockin-light-180-v3.png",
        "icons/lockin-light-192-v3.png",
        "icons/lockin-light-512-v3.png",
        "icons/lockin-light-maskable-512-v3.png",
        "startup.css"
      ],
      manifest: {
        id: basePath,
        name: "Lock-in Study Workspace",
        short_name: "Lock-in",
        description: "Modern study space for dental students.",
        lang: "en",
        theme_color: "#070b16",
        background_color: "#070b16",
        display: "standalone",
        display_override: ["standalone", "minimal-ui"],
        orientation: "any",
        start_url: basePath,
        scope: basePath,
        // When the platform does hand an in-scope link to the installed app --
        // Chromium desktop and Android, where link capturing exists -- reuse the
        // window that is already open instead of stacking a second one, so a
        // verification link lands in the session the reader already has.
        //
        // This is the whole of what the web platform offers here. It cannot
        // make a link open the installed app: that decision belongs to the
        // client that owns the tap (Gmail opens links in its own in-app
        // browser on both platforms), and on iOS a home-screen web app has no
        // link capturing at all. See docs/PWA_EMAIL_LINKS.md.
        launch_handler: { client_mode: "navigate-existing" },
        categories: ["education", "productivity"],
        prefer_related_applications: false,
        icons: [
          {
            src: "icons/lockin-light-192-v3.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/lockin-light-512-v3.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/lockin-light-maskable-512-v3.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      injectManifest: {
        injectionPoint: "self.__WB_MANIFEST",
        // Offline navigation needs lazy route chunks before the reader opens
        // them. Every file is build-hashed, so Workbox safely drops stale app
        // code on upgrade. Large media and authenticated API data stay outside
        // the precache and are explicit user downloads only.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: [
          "index.html",
          "manifest.webmanifest",
          "assets/*.js",
          "assets/*.mjs",
          "assets/*.css"
        ],
        // The operations and moderation consoles are staff-only and work only
        // online, so every student device need not download them on each
        // release. They load from the network when opened, as before.
        globIgnores: [
          "assets/OperationsAdmin-*",
          "assets/Moderation-*"
        ]
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5050,
    // A phone that backgrounds Vite's development WebSocket can reconnect as
    // though it has missed an HMR update. This project is frequently tested
    // through a tunnel on mobile, where that can look exactly like an app
    // reload. Keep development refreshes manual; production has no HMR client.
    hmr: false,
    // Codespaces serves the 5173 port over a private github.dev host.
    // Permit only this Codespace's assigned hostname, not arbitrary hosts.
    allowedHosts: [
      ".trycloudflare.com", ".ngrok-free.app", ".ngrok-free.dev", ".ngrok.app", ".ngrok.io",
      ...(env.CODESPACE_NAME ? [`${env.CODESPACE_NAME}-5173.app.github.dev`] : [])
    ],
    proxy: {
      "/api/v1": {
        target: djangoProxyTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            // Django intentionally permits same-origin CSRF requests only. The
            // development proxy makes Vite requests appear same-origin upstream.
            proxyReq.setHeader("origin", djangoOrigin);
          });
        }
      }
    }
  }
  };
});
