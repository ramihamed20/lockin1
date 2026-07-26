import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // This value is used only by Vite's development proxy. Browser requests stay
  // same-origin at /api/v1, so session cookies are never sent by the browser to
  // this target directly.
  const djangoProxyTarget = env.VITE_DJANGO_PROXY_TARGET || "http://127.0.0.1:8000";
  const djangoOrigin = new URL(djangoProxyTarget).origin;

  return {
  base: process.env.GITHUB_ACTIONS ? "/test-dinta/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "service-worker.js",
      includeAssets: ["assets/favicon.svg", "apple-touch-icon.png", "maskable-icon.png"],
      manifest: {
        name: "Lock-in Study Workspace",
        short_name: "Lock-in",
        description: "Modern study space for dental students.",
        theme_color: "#070b16",
        background_color: "#070b16",
        display: "standalone",
        orientation: "portrait",
        start_url: process.env.GITHUB_ACTIONS ? "/test-dinta/" : "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "maskable-icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,jpeg}"]
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5050,
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
