import { timingSafeEqual } from "node:crypto";
import { deliverCommands, type DeliveryOutcome } from "../../interbox/src/mdm/commit.ts";
import type { PlannerConfig } from "../../interbox/src/mdm/planning.ts";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Content-Type": "application/fhir+json" } });
}

function outcome(message: string, code = "invalid") {
  return { resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics: message }] };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function responseEntry(result: DeliveryOutcome<unknown>) {
  if (result.status === "accepted") return { response: { status: "200 OK" } };
  return {
    response: { status: result.status === "retry" ? "503 Service Unavailable" : "422 Unprocessable Entity" },
    resource: outcome(result.message ?? result.errorKind ?? "Command failed", result.status === "retry" ? "transient" : "processing"),
  };
}

export function createHandler(config: PlannerConfig, token: string) {
  if (!token) throw new Error("MDM_ADAPTER_TOKEN is required");
  const expected = Buffer.from(`Bearer ${token}`);
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/health") return Response.json({ status: "ready" });
    const provided = Buffer.from(request.headers.get("authorization") ?? "");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return json(outcome("Invalid adapter credentials", "login"), 401);
    }
    if (path !== "/fhir" || request.method !== "POST") return json(outcome("Only POST /fhir batch delivery is supported", "not-supported"), 404);
    let body: unknown;
    try { body = await request.json(); }
    catch { return json(outcome("Expected a JSON Bundle"), 400); }
    if (!object(body) || body.resourceType !== "Bundle" || body.type !== "batch" || !Array.isArray(body.entry)) {
      return json(outcome("Expected a Bundle of type batch with an entry array"), 400);
    }
    const entries = [];
    for (const entry of body.entry) {
      if (!object(entry) || !object(entry.request) || !object(entry.resource)
          || entry.request.method !== "PUT" || entry.resource.resourceType !== "Task"
          || entry.request.url !== `Task/${String(entry.resource.id)}`) {
        entries.push(responseEntry({ resource: null, status: "rejected", message: "Expected PUT Task/{id} with an immutable command Task; changed commands require a new id" }));
        continue;
      }
      const [result] = await deliverCommands(config, [entry.resource]);
      entries.push(responseEntry(result!));
    }
    return json({ resourceType: "Bundle", type: "batch-response", entry: entries });
  };
}
