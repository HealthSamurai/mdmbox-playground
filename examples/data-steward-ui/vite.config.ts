import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ mode }) => {
  // Vite only exposes VITE_-prefixed vars by default and never loads .env into
  // process.env. Load all vars (empty prefix) so backend URLs and credentials
  // from .env are available to the development proxy.
  const env = loadEnv(mode, process.cwd(), "");
  const AIDBOX_URL = env.AIDBOX_URL || "http://localhost:8888";
  const AIDBOX_AUTH = env.AIDBOX_AUTH;
  const MDMBOX_URL = env.MDMBOX_URL || "http://localhost:3003";
  const MDMBOX_AUTH = env.MDMBOX_AUTH;

  // Inject Authorization into proxied requests, mirroring the production
  // proxy in server/index.ts without exposing credentials to the browser.
  const injectAuth = (
    proxy: { on: (e: string, cb: (...a: any[]) => void) => void },
    auth?: string,
  ) => {
    if (!auth) return;
    proxy.on("proxyReq", (proxyReq: any) => {
      if (!proxyReq.getHeader("authorization")) {
        proxyReq.setHeader("authorization", auth);
      }
    });
  };

  // Dev-mode equivalent of the Bun server's /app-info endpoint, so the
  // frontend can read the configured MDMbox URL without hitting it directly.
  const appInfoPlugin = {
    name: "app-info",
    configureServer(server: any) {
      server.middlewares.use("/app-info", (_req: any, res: any) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ mdmboxUrl: MDMBOX_URL }));
      });
    },
  };

  return {
    plugins: [react(), tailwindcss(), appInfoPlugin],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        treeshake: {
          moduleSideEffects: (id) => {
            if (id.includes("@health-samurai/react-components")) return false;
            return true;
          },
        },
      },
    },
    server: {
      port: 3002,
      proxy: {
        "/api": {
          target: MDMBOX_URL,
          changeOrigin: true,
          configure: (proxy) => injectAuth(proxy, MDMBOX_AUTH),
        },
        "/fhir-server-api": {
          target: AIDBOX_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/fhir-server-api/, "/fhir"),
          configure: (proxy) => injectAuth(proxy, AIDBOX_AUTH),
        },
      },
    },
  };
});
