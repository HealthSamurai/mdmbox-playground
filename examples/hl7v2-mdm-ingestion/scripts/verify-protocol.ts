import assert from "node:assert/strict";
import { commitCommand, commitPlan, deliverCommands } from "../interbox/src/mdm/commit.ts";
import { HttpError, planMdmCommand, type MdmCommand, type PlannerConfig } from "../interbox/src/mdm/planning.ts";

import { encodeCommand } from "../interbox/src/mdm/command.ts";

const config: PlannerConfig = {
  aidboxUrl: process.env.AIDBOX_URL ?? "http://localhost:8890",
  aidboxUser: process.env.AIDBOX_USER ?? "root",
  aidboxPassword: process.env.AIDBOX_PASSWORD ?? "showcase",
  mdmboxUrl: process.env.MDMBOX_URL ?? "http://localhost:3005",
  matchingModel: "showcase-patient",
};
const auth = `Basic ${Buffer.from(`${config.aidboxUser}:${config.aidboxPassword}`).toString("base64")}`;
const run = Date.now().toString(36);
function command(suffix: string, family = `Protocol-${run}`): MdmCommand {
  return {
    messageId: `protocol-${run}-${suffix}`, event: "A01", source: "registry",
    patient: {
      resourceType: "Patient", id: `protocol-${run}-${suffix}`,
      name: [{ family, given: ["Synthetic"] }], birthDate: "1980-01-01",
      meta: { tag: [
        { system: "https://mdm.health-samurai.io/fhir/CodeSystem/patient-kind", code: "source" },
        { system: "https://mdm.health-samurai.io/fhir/CodeSystem/source-system", code: "registry" },
      ] },
    },
  };
}
async function read(path: string) {
  return fetch(`${config.aidboxUrl}/fhir/${path}`, { headers: { Authorization: auth } });
}

const a = command("a"), b = command("b"), c = command("c");
await commitCommand(config, a);
const [planB, planC] = await Promise.all([planMdmCommand(config, b), planMdmCommand(config, c)]);
assert.equal(planB.kind, "transaction");
assert.equal(planC.kind, "transaction");
if (planB.kind !== "transaction" || planC.kind !== "transaction") throw new Error("Expected fresh plans");
assert.equal(planB.expectedRevision, planC.expectedRevision, "Run this check after seed has completed and ingestion is idle");
await commitPlan(config, planB);
await assert.rejects(() => commitPlan(config, planC), error => error instanceof HttpError);
assert.equal((await read(`Patient/${c.patient.id}`)).status, 404, "stale transaction must not create Patient C");
assert.equal((await read(`Task/${c.messageId}`)).status, 404, "stale transaction must not create a receipt");
await commitCommand(config, c);
const membershipResponse = await read(`Linkage?item=Patient/${c.patient.id}`);
assert.ok(membershipResponse.ok);
const membership = await membershipResponse.json();
assert.equal(membership.total, 1);
assert.deepEqual(membership.entry[0].resource.item.filter((item: { type: string }) => item.type === "alternate").map((item: { resource: { reference: string } }) => item.resource.reference).sort(), [a, b, c].map(item => `Patient/${item.patient.id}`).sort());
console.log("✓ stale plan rolls back completely; replanning produces one three-member cluster");

let transactionRequests = 0;
const proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const incoming = new URL(request.url);
  const headers = new Headers(request.headers);
  headers.delete("host");
  const upstream = await fetch(`${config.aidboxUrl}${incoming.pathname}${incoming.search}`, {
    method: request.method, headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
  });
  if (request.method === "POST" && incoming.pathname === "/fhir") {
    transactionRequests++;
    if (transactionRequests === 1 && upstream.ok) {
      await upstream.arrayBuffer();
      return Response.json({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "transient" }] }, { status: 503 });
    }
  }
  return upstream;
} });
try {
  const retryConfig = { ...config, aidboxUrl: `http://127.0.0.1:${proxy.port}` };
  const envelope = encodeCommand(command("lost", `Lost-response-${run}`));
  assert.equal((await deliverCommands(retryConfig, [envelope]))[0]?.status, "retry");
  const before = await (await read(`Task/${envelope.id}`)).json();
  assert.equal(before.status, "completed", "clinical commit succeeded before its response was lost");
  assert.equal((await deliverCommands(retryConfig, [envelope]))[0]?.status, "accepted");
  const after = await (await read(`Task/${envelope.id}`)).json();
  assert.equal(transactionRequests, 1, "redelivery must not issue another clinical transaction");
  assert.equal(after.meta.versionId, before.meta.versionId);
  console.log("✓ lost commit response is recovered from the receipt without repeating the transaction");
} finally {
  proxy.stop(true);
}
console.log("PROTOCOL VERIFIED: four synthetic source Patients added");
