import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ mode }) => {
  // vite only exposes VITE_-prefixed vars by default and never loads .env
  // into process.env. Load all vars (empty prefix) so MDMBOX_URL/MDMBOX_AUTH
  // from .env are available here.
  const env = loadEnv(mode, process.cwd(), "");
  const MDMBOX_URL = env.MDMBOX_URL || "http://localhost:3003";
  const MDMBOX_AUTH = env.MDMBOX_AUTH;

  // Inject the Authorization header into proxied MDMbox requests, mirroring
  // the production proxy in server/index.ts. Without this, `bun dev` (vite)
  // forwards requests with no auth and MDMbox returns 401 when auth is enabled.
  const injectAuth = (proxy: { on: (e: string, cb: (...a: any[]) => void) => void }) => {
    if (!MDMBOX_AUTH) return;
    proxy.on("proxyReq", (proxyReq: any) => {
      if (!proxyReq.getHeader("authorization")) {
        proxyReq.setHeader("authorization", MDMBOX_AUTH);
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
          configure: (proxy) => injectAuth(proxy),
        },
        "/fhir-server-api": {
          target: MDMBOX_URL,
          changeOrigin: true,
          configure: (proxy) => injectAuth(proxy),
        },
      },
    },
  };
});
