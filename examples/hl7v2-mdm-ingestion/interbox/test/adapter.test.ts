import { afterEach, expect, test } from "bun:test";
import { encodeCommand, decodeCommand, type MdmCommand } from "../src/mdm/command.ts";
import { deliverCommands } from "../src/mdm/commit.ts";
import { createHandler } from "../../adapter/src/http.ts";
import type { SenderConfig, SenderDefinition } from "@health-samurai/interbox/core";
import type { PlannerConfig } from "../src/mdm/planning.ts";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const command = (id: string): MdmCommand => ({
  messageId: id, event: "A01", source: "registry",
  patient: { resourceType: "Patient", id: `patient-${id}` },
});
const task = (id: string) => encodeCommand(command(id));
const entry = (id: string) => ({ request: { method: "PUT", url: `Task/${id}` }, resource: task(id) });
const batch = (entries: unknown[]) => new Request("http://adapter/fhir", {
  method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/fhir+json" },
  body: JSON.stringify({ resourceType: "Bundle", type: "batch", entry: entries }),
});

function fixture(beforeCommit?: () => Promise<void>) {
  const commits: string[] = [];
  const receipts = new Map<string, unknown>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/fhir/Basic/mdm-revision") return Response.json({ resourceType: "Basic", id: "mdm-revision", meta: { versionId: "1" } });
    if (path.startsWith("/fhir/Task/") && receipts.has(path)) return Response.json(receipts.get(path));
    if (path.endsWith("/$match")) return Response.json({ resourceType: "Bundle", total: 0, entry: [] });
    if (path === "/fhir" && request.method === "POST") {
      const bundle = await request.json() as { entry: Array<{ resource: { resourceType: string; id: string } }> };
      const receipt = bundle.entry.find(e => e.resource.resourceType === "Task")!.resource;
      commits.push(receipt.id);
      if (receipt.id === "retry") return Response.json({ resourceType: "OperationOutcome" }, { status: 503 });
      if (receipt.id === "rejected") return Response.json({ resourceType: "OperationOutcome" }, { status: 422 });
      if (beforeCommit) await beforeCommit();
      receipts.set(`/fhir/Task/${receipt.id}`, receipt);
      return Response.json({ resourceType: "Bundle", type: "transaction-response", entry: bundle.entry.map(() => ({ response: { status: "200" } })) });
    }
    return Response.json({ resourceType: "OperationOutcome" }, { status: 404 });
  } });
  servers.push(server);
  const url = `http://127.0.0.1:${server.port}`;
  const config = { aidboxUrl: url, mdmboxUrl: url, aidboxUser: "root", aidboxPassword: "test", matchingModel: "patient" };
  return { config, commits, handler: createHandler(config, "test-token") };
}

test("versioned command Task round-trips without exposing Patient references to the sender", () => {
  const original = { ...command("unicode"), patient: { ...command("unicode").patient, name: [{ family: "Müller" }] } };
  const encoded = encodeCommand(original);
  expect(decodeCommand(encoded)).toEqual(original);
  expect(JSON.stringify(encoded)).not.toContain('"reference"');
  expect(() => decodeCommand({ ...encoded, id: "different" })).toThrow("messageId");
});

test("portable delivery returns one outcome per original object and continues after failures", async () => {
  const { config, commits } = fixture();
  const resources = [task("rejected"), task("ok"), task("retry"), task("last")];
  const nativeContract: SenderDefinition<PlannerConfig & SenderConfig, readonly unknown[]> = {
    type: "mdm-aidbox", send: deliverCommands,
  };
  const outcomes = await nativeContract.send({ ...config, dbUrl: "unused-by-mdm" }, resources);
  expect(outcomes.map(o => o.status)).toEqual(["rejected", "accepted", "retry", "accepted"]);
  outcomes.forEach((outcome, index) => expect(outcome.resource).toBe(resources[index]));
  expect(commits).toEqual(["rejected", "ok", "retry", "last"]);
});

test("HTTP maps independent command outcomes to ordered batch-response entries", async () => {
  const { handler } = fixture();
  const response = await handler(batch([entry("ok"), entry("rejected"), entry("retry")]));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.type).toBe("batch-response");
  expect(body.entry.map((e: { response: { status: string } }) => e.response.status)).toEqual(["200 OK", "422 Unprocessable Entity", "503 Service Unavailable"]);
});

test("HTTP never acknowledges success before the clinical transaction completes", async () => {
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const { handler } = fixture(async () => { started(); await gate; });
  let responded = false;
  const pending = handler(batch([entry("delayed")])).then(response => { responded = true; return response; });
  try {
    await entered;
    expect(responded).toBe(false);
  } finally { release(); }
  expect((await (await pending).json()).entry[0].response.status).toBe("200 OK");
});

test("retrying a completed HTTP command uses its receipt without another transaction", async () => {
  const { handler, commits } = fixture();
  await handler(batch([entry("repeat")]));
  const second = await handler(batch([entry("repeat")]));
  expect((await second.json()).entry[0].response.status).toBe("200 OK");
  expect(commits).toEqual(["repeat"]);
});

test("invalid credentials, transaction bundles and malformed requests cause no writes", async () => {
  const { handler, commits } = fixture();
  expect((await handler(new Request("http://adapter/fhir", { method: "POST" }))).status).toBe(401);
  const wrongType = new Request("http://adapter/fhir", { method: "POST", headers: { Authorization: "Bearer test-token" }, body: JSON.stringify({ resourceType: "Bundle", type: "transaction", entry: [entry("no")] }) });
  expect((await handler(wrongType)).status).toBe(400);
  expect((await handler(new Request("http://adapter/fhir", { method: "POST", headers: { Authorization: "Bearer test-token" }, body: "{" }))).status).toBe(400);
  expect(commits).toEqual([]);
});

test("the adapter rejects changed command PATCH, wrong target and foreign Condition subject per entry", async () => {
  const { handler, commits } = fixture();
  const foreign = task("foreign");
  foreign.input[0]!.valueAttachment.data = Buffer.from(JSON.stringify({ ...command("foreign"), conditions: [{ resourceType: "Condition", id: "c", subject: { reference: "Patient/other" } }] })).toString("base64");
  const response = await handler(batch([
    { ...entry("patch"), request: { method: "PATCH", url: "Task/patch" } },
    { ...entry("target"), request: { method: "PUT", url: "Task/other" } },
    { resource: foreign, request: { method: "PUT", url: "Task/foreign" } },
    entry("valid"),
  ]));
  expect((await response.json()).entry.map((e: { response: { status: string } }) => e.response.status)).toEqual(["422 Unprocessable Entity", "422 Unprocessable Entity", "422 Unprocessable Entity", "200 OK"]);
  expect(commits).toEqual(["valid"]);
});
