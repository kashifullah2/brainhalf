import { vitePlugin as remix } from "@remix-run/dev"
import { cloudflareDevProxyVitePlugin } from "@remix-run/dev"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

/** Set BRAINHALF_CF_DEV=1 to emulate Pages bindings locally (uses many file watchers). */
const useCloudflareDevProxy = process.env.BRAINHALF_CF_DEV === "1"

export default defineConfig({
  plugins: [
    ...(useCloudflareDevProxy ? [cloudflareDevProxyVitePlugin()] : []),
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: true,
      },
    }),
    tailwindcss(),
  ],
  server: {
    port: 5174,
    watch: {
      ignored: [
        "**/.wrangler/**",
        "**/node_modules/**",
        "**/build/**",
        "**/.turbo/**",
      ],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
})
