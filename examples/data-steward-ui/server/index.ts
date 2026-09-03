import path from "path";

const PORT = parseInt(process.env.PORT || "3000");
const AIDBOX_URL = process.env.AIDBOX_URL || "http://localhost:8888";
const AIDBOX_AUTH = process.env.AIDBOX_AUTH;
const MDMBOX_URL = process.env.MDMBOX_URL || "http://localhost:3003";
const MDMBOX_AUTH = process.env.MDMBOX_AUTH;
const DIST_DIR = path.resolve(import.meta.dir, "../dist");

async function proxyRequest(req: Request, target: string, auth?: string) {
  const headers = new Headers(req.headers);
  headers.delete("host");

  // Inject auth server-side so credentials never reach the browser.
  // Preserve an Authorization header explicitly supplied by the client.
  if (auth && !headers.has("authorization")) {
    headers.set("authorization", auth);
  }

  const res = await fetch(target, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
  });

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

const server = Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/app-info") {
      return Response.json({ mdmboxUrl: MDMBOX_URL });
    }

    if (url.pathname.startsWith("/api/")) {
      return proxyRequest(
        req,
        `${MDMBOX_URL}${url.pathname}${url.search}`,
        MDMBOX_AUTH,
      );
    }

    if (url.pathname.startsWith("/aidbox-fhir")) {
      const fhirPath = url.pathname.replace(/^\/aidbox-fhir/, "/fhir");
      return proxyRequest(
        req,
        `${AIDBOX_URL}${fhirPath}${url.search}`,
        AIDBOX_AUTH,
      );
    }

    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(path.join(DIST_DIR, filePath));

    if (await file.exists()) {
      return new Response(file);
    }

    return new Response(Bun.file(path.join(DIST_DIR, "index.html")));
  },
});

console.log(`Server running at http://localhost:${server.port}`);
