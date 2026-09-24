import { createHandler } from "./http.ts";

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? "8091"),
  maxRequestBodySize: 8 * 1024 * 1024,
  idleTimeout: 255,
  fetch: createHandler({
    aidboxUrl: process.env.AIDBOX_URL ?? "http://aidbox:8080",
    aidboxUser: process.env.AIDBOX_USER ?? "root",
    aidboxPassword: process.env.AIDBOX_PASSWORD ?? "showcase",
    mdmboxUrl: process.env.MDMBOX_URL ?? "http://mdmbox:3000",
    matchingModel: process.env.MDM_MATCHING_MODEL ?? "showcase-patient",
  }, process.env.MDM_ADAPTER_TOKEN ?? ""),
});

console.log(`MDM command adapter listening on ${server.port}`);
process.on("SIGTERM", async () => { await server.stop(); process.exit(0); });
