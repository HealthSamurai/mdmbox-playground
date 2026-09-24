import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { spawn } from "node:child_process";
import net from "node:net";

let server;
let base;
before(async () => {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: "pipe" });
  let output = "";
  server.stdout.on("data", data => { output += data; });
  server.stderr.on("data", data => { output += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(output);
    try { if ((await fetch(base)).ok) return; } catch { /* waiting for startup */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Portal did not start: ${output}`);
});
after(() => { server?.kill("SIGTERM"); });

async function render(path = "/") {
  return fetch(`${base}${path}`, { headers: { accept: "text/html" } });
}

test("server-renders the HL7v2 ingestion portal", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>HL7v2 Ingestion · MDMbox<\/title>/i);
  assert.match(html, /Ingestion status/);
  assert.match(html, /Aidbox ↔ ClickHouse/);
  assert.match(html, /Patient registry/);
  assert.match(html, /Source conditions/);
  assert.match(html, /Unique diagnoses/);
  assert.match(html, /Clusters/);
  assert.match(html, /Singleton/);
  assert.match(html, /All diagnoses/);
  assert.match(html, /With duplicates/);
  assert.doesNotMatch(html, />Contained golden</);
  assert.ok(
    html.indexOf("Analytics delivery") <
      html.indexOf("Patient registry"),
    "operational status is rendered before the patient registry",
  );
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("server-renders a dedicated logical Patient page", async () => {
  const response = await render("/patients/singleton/source-example");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Patient details/i);
  assert.match(html, /Patient registry/);
});
