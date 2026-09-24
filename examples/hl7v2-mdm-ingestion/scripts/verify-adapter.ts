import assert from "node:assert/strict";
import { encodeCommand } from "../interbox/src/mdm/command.ts";

const adapterUrl = process.env.MDM_ADAPTER_URL ?? "http://localhost:8091";
const aidboxUrl = process.env.AIDBOX_URL ?? "http://localhost:8890";
const auth = `Basic ${Buffer.from(`${process.env.AIDBOX_USER ?? "root"}:${process.env.AIDBOX_PASSWORD ?? "showcase"}`).toString("base64")}`;
const id = `adapter-${Date.now().toString(36)}`;
const task = encodeCommand({
  messageId: id, event: "A01", source: "registry",
  patient: {
    resourceType: "Patient", id,
    name: [{ family: id, given: ["Synthetic"] }], birthDate: "1980-01-01",
    meta: { tag: [
      { system: "https://mdm.health-samurai.io/fhir/CodeSystem/patient-kind", code: "source" },
      { system: "https://mdm.health-samurai.io/fhir/CodeSystem/source-system", code: "registry" },
    ] },
  },
});
async function read(path: string) {
  const response = await fetch(`${aidboxUrl}/fhir/${path}`, { headers: { Authorization: auth } });
  assert.ok(response.ok, `Read ${path}: ${response.status}`);
  return response.json();
}
const validation = await fetch(`${aidboxUrl}/fhir/Task/$validate`, {
  method: "POST", headers: { Authorization: auth, "Content-Type": "application/fhir+json" }, body: JSON.stringify(task),
});
assert.ok(validation.ok, `Command Task validation: ${validation.status}`);
const issues = (await validation.json()).issue ?? [];
assert.ok(!issues.some((issue: { severity: string }) => ["error", "fatal"].includes(issue.severity)), JSON.stringify(issues));
console.log("✓ transport command validates as a FHIR Task");

let attempts = 0;
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const response = await fetch(`${adapterUrl}/fhir`, { method: "POST", headers: request.headers, body: await request.arrayBuffer() });
  const body = await response.json();
  attempts++;
  if (attempts === 1 && body.entry?.[0]?.response?.status === "200 OK") {
    return Response.json({ resourceType: "OperationOutcome" }, { status: 503 });
  }
  return Response.json(body, { status: response.status });
} });
async function deliver(entries: unknown[]) {
  return fetch(`http://127.0.0.1:${proxy.port}/fhir`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.MDM_ADAPTER_TOKEN ?? "showcase-adapter"}`, "Content-Type": "application/fhir+json" },
    body: JSON.stringify({ resourceType: "Bundle", type: "batch", entry: entries }),
  });
}
const entry = { request: { method: "PUT", url: `Task/${id}` }, resource: task };
try {
  assert.equal((await deliver([entry])).status, 503, "simulate losing the successful adapter response");
  const receipt = await read(`Task/${id}`);
  assert.equal(receipt.status, "completed", "the clinical transaction committed before acknowledgement");
  const revision = await read("Basic/mdm-revision");
  const response = await deliver([
    { ...entry, request: { method: "PATCH", url: `Task/${id}` } },
    entry,
  ]);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).entry.map((e: { response: { status: string } }) => e.response.status), ["422 Unprocessable Entity", "200 OK"]);
  assert.equal((await read(`Task/${id}`)).meta.versionId, receipt.meta.versionId);
  assert.equal((await read("Basic/mdm-revision")).meta.versionId, revision.meta.versionId, "redelivery issues no second clinical transaction; run with ingestion idle");
  console.log("✓ lost adapter response recovers from receipt; rejected entry does not hide successful redelivery");
} finally { proxy.stop(true); }
console.log("ADAPTER VERIFIED: one synthetic source Patient added");
