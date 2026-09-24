import { afterEach, expect, test } from "bun:test";
import { planMdmCommand, type FhirResource, type MdmCommand, type PlannerConfig } from "../src/mdm/planning.ts";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.stop(true); });
const kind = "https://mdm.health-samurai.io/fhir/CodeSystem/patient-kind";
const conditionKind = "https://mdm.health-samurai.io/fhir/CodeSystem/condition-kind";
const patient = (id: string): MdmCommand["patient"] => ({
  resourceType: "Patient", id, name: [{ family: "Smith", given: ["Jane"] }],
  birthDate: "1980-01-01", meta: { tag: [{ system: kind, code: "source" }] },
});
const condition = (id: string, subject: string): FhirResource & { resourceType: "Condition"; id: string } => ({
  resourceType: "Condition", id, subject: { reference: `Patient/${subject}` },
  meta: { tag: [{ system: conditionKind, code: "source" }] },
  code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10", code: "I10" }] },
  onsetDateTime: "2026-01-01T12:00:00Z",
});

function fixture(options: { total?: number; conditions?: FhirResource[]; patientMatch?: boolean } = {}) {
  const calls: URL[] = [];
  const matchRequests: Record<string, unknown>[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const url = new URL(request.url);
    calls.push(url);
    const json = (body: unknown, status = 200) => Response.json(body, { status });
    if (url.pathname === "/fhir/Basic/mdm-revision") return json({ resourceType: "Basic", id: "mdm-revision", meta: { versionId: "1" } });
    if (url.pathname === "/api/fhir/r4/Patient/$match") {
      matchRequests.push(await request.json());
      const matches = options.patientMatch === false ? [] : [patient("existing")];
      return json({ resourceType: "Bundle", type: "searchset", total: options.total ?? matches.length, entry: matches.map(resource => ({ resource })) });
    }
    if (url.pathname === "/fhir/Patient/existing") return json({ ...patient("existing"), meta: { ...patient("existing").meta, versionId: "1" } });
    if (url.pathname === "/fhir/Linkage") return json({ resourceType: "Bundle", total: 0, entry: [] });
    if (url.pathname === "/fhir/Condition") {
      const selected = (options.conditions ?? []).filter(resource => (resource.subject as { reference: string }).reference === url.searchParams.get("subject"));
      return json({ resourceType: "Bundle", total: selected.length, entry: selected.map(resource => ({ resource })) });
    }
    if (url.pathname.startsWith("/api/fhir/r4/Condition/")) return json({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-supported" }] }, 400);
    return json({ resourceType: "OperationOutcome" }, 404);
  } });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const config: PlannerConfig = { aidboxUrl: base, mdmboxUrl: base, aidboxUser: "root", aidboxPassword: "test", matchingModel: "patient" };
  const command: MdmCommand = { messageId: "message-1", event: "A01", source: "hospital", patient: patient("incoming") };
  return { config, command, calls, matchRequests };
}

test("an incomplete candidate response cannot produce an automatic cluster", async () => {
  const { config, command } = fixture({ total: 11 });
  await expect(planMdmCommand(config, command)).rejects.toThrow("incomplete");
});

test("Condition matching searches only the planned Patient cluster using current FHIR endpoints", async () => {
  const { config, command, calls } = fixture({ conditions: [condition("same", "existing"), condition("other-person", "unrelated")] });
  command.conditions = [condition("incoming-condition", "incoming")];
  const plan = await planMdmCommand(config, command);
  expect(plan.kind).toBe("transaction");
  if (plan.kind !== "transaction") throw new Error("Expected a transaction");
  const linkages = plan.transaction.entry.map(entry => entry.resource).filter(resource => resource.resourceType === "Linkage");
  const references = JSON.stringify(linkages);
  expect(references).toContain("Condition/same");
  expect(references).toContain("Condition/incoming-condition");
  expect(references).not.toContain("Condition/other-person");
  expect(calls.some(url => url.pathname.includes("Condition/$match"))).toBe(false);
  expect(calls.filter(url => url.pathname === "/fhir/Condition").map(url => url.searchParams.get("subject")).sort()).toEqual(["Patient/existing", "Patient/incoming"]);
});

test("equal diagnoses within one command belong to one Condition Linkage", async () => {
  const { config, command } = fixture({ patientMatch: false });
  command.conditions = [condition("first", "incoming"), condition("second", "incoming"), condition("third", "incoming")];
  const plan = await planMdmCommand(config, command);
  if (plan.kind !== "transaction") throw new Error("Expected a transaction");
  const linkages = plan.transaction.entry.map(entry => entry.resource).filter(resource => resource.resourceType === "Linkage");
  expect(linkages).toHaveLength(1);
  expect((linkages[0]!.item as unknown[])).toHaveLength(3);
});
