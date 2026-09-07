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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const appVersion = env.VITE_APP_VERSION || process.env.GITHUB_SHA || "local";
  const basePath = normalizeBasePath(env.VITE_BASE_PATH || "/");
  // This value is used only by Vite's development proxy. Browser requests stay
  // same-origin at /api/v1, so session cookies are never sent by the browser to
  // this target directly.
  const djangoProxyTarget = env.VITE_DJANGO_PROXY_TARGET || "http://127.0.0.1:8000";
  const djangoOrigin = new URL(djangoProxyTarget).origin;

  return {
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion)
  },
  plugins: [
    react(),
    ...(mode === "development" ? [removeLegacyWorkerInDevelopment()] : []),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      strategies: "injectManifest",
      srcDir: "src",
      filename: "service-worker.js",
      includeAssets: [
        "icons/lockin-light-16-v2.png",
        "icons/lockin-light-32-v2.png",
        "icons/lockin-light-180-v2.png",
        "icons/lockin-light-192-v2.png",
        "icons/lockin-light-512-v2.png",
        "icons/lockin-light-maskable-512-v2.png",
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
            src: "icons/lockin-light-192-v2.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/lockin-light-512-v2.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/lockin-light-maskable-512-v2.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      injectManifest: {
        injectionPoint: "self.__WB_MANIFEST",
        // Keep installation lightweight: only the application entry shell is
        // precached. Lazy routes and visual media are cached after first use.
        globPatterns: [
          "index.html",
          "manifest.webmanifest",
          "assets/index-*.js",
          "assets/index-*.css"
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
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok-free.dev", ".ngrok.app", ".ngrok.io"],
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
