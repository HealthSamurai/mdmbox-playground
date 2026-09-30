import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // Load every variable from .env, not only VITE_*: the proxy needs the backend URLs and credentials.
  const env = loadEnv(mode, process.cwd(), "");
  const aidboxUrl = env.AIDBOX_URL || "http://localhost:8888";
  const mdmboxUrl = env.MDMBOX_URL || "http://localhost:3003";

  // The dev server adds credentials to proxied requests, so they never reach the browser.
  const proxyTo = (target: string, auth?: string): ProxyOptions => ({
    target,
    changeOrigin: true,
    configure: (proxy) => {
      if (auth) proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("authorization", auth));
    },
  });

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __MDMBOX_URL__: JSON.stringify(mdmboxUrl),
    },
    server: {
      port: 3007,
      proxy: {
        // MDMbox API: continuous matching results, $merge/v2, $mark-not-a-match
        "/api": proxyTo(mdmboxUrl, env.MDMBOX_AUTH),
        // Aidbox FHIR API: Patient records, BulkMatchingModel, merge Tasks
        "/fhir": proxyTo(aidboxUrl, env.AIDBOX_AUTH),
      },
    },
  };
});
