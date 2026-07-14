import path from "path";

const PORT = parseInt(process.env.PORT || "3000");
const MDMBOX_URL = process.env.MDMBOX_URL || "http://localhost:3003";
const MDMBOX_AUTH = process.env.MDMBOX_AUTH;
const DIST_DIR = path.resolve(import.meta.dir, "../dist");

const server = Bun.serve({
  port: PORT,

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/app-info") {
      return Response.json({ mdmboxUrl: MDMBOX_URL });
    }

    if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/fhir-server-api")
    ) {
      const target = `${MDMBOX_URL}${url.pathname}${url.search}`;

      const headers = new Headers(req.headers);
      headers.delete("host");

      // Inject auth server-side so credentials never reach the browser.
      // Skip if the client already sent an Authorization header.
      if (MDMBOX_AUTH && !headers.has("authorization")) {
        headers.set("authorization", MDMBOX_AUTH);
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

    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(path.join(DIST_DIR, filePath));

    if (await file.exists()) {
      return new Response(file);
    }

    return new Response(Bun.file(path.join(DIST_DIR, "index.html")));
  },
});

console.log(`Server running at http://localhost:${server.port}`);
