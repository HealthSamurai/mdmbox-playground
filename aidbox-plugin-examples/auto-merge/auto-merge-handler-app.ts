/**
 * auto-merge handler app
 *
 * Aidbox calls this server (via AidboxTopicDestination) whenever a Patient is
 * created. The server then runs $match + $merge against MDMbox automatically
 * to search for duplicates and merge them automatically.
 *
 */

type JsonRecord = Record<string, any>;

type JsonResponse = {
  ok: boolean;
  status: number;
  url: string;
  body: unknown;
  text: string;
};

type FlowStep = {
  at: string;
  label: string;
  ok: boolean;
  details?: unknown;
};

type FlowEvent = {
  id: string;
  patientId: string;
  status: "received" | "matching" | "no-match" | "merging" | "merged" | "error";
  startedAt: string;
  updatedAt: string;
  notification: unknown;
  steps: FlowStep[];
  patient?: JsonRecord;
  matchRequest?: unknown;
  matchResponse?: unknown;
  matchedPatient?: JsonRecord;
  mergeRequest?: unknown;
  mergeResponse?: unknown;
  mergedPatient?: JsonRecord;
  error?: string;
};

const PORT = parseInt(process.env.WEBHOOK_PORT || "3301", 10);

const AIDBOX_URL = trimSlash(process.env.AIDBOX_URL || "http://localhost:8888");
const AIDBOX_AUTH = process.env.AIDBOX_AUTH || "Basic cm9vdDpyb290"; // root:root

const MDMBOX_URL = trimSlash(process.env.MDMBOX_URL || "http://localhost:3003");
const MDMBOX_CLIENT_ID = process.env.MDMBOX_CLIENT_ID || "mdmbox-automerge-client";
const MDMBOX_CLIENT_SECRET =
  process.env.MDMBOX_CLIENT_SECRET || "mdmbox-automerge-secret";
const MDMBOX_APP_AUTH =
  process.env.MDMBOX_APP_AUTH || basicAuth(MDMBOX_CLIENT_ID, MDMBOX_CLIENT_SECRET);

const MODEL_ID = process.env.MODEL_ID || "patient-example";
const MATCH_RESULT_LIMIT = parseInt(process.env.MATCH_RESULT_LIMIT || "1", 10);

const WEBHOOK_PATH = "/webhooks/patient-created";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "aidbox-to-bun-secret";

const flows: FlowEvent[] = [];
const flowByPatientId = new Map<string, FlowEvent>();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function jsonRequest(
  url: string,
  opts: {
    method?: string;
    auth?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<JsonResponse> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...opts.headers,
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.auth) headers.authorization = opts.auth;

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    url,
    body: safeJson(text),
    text,
  };
}

async function aidboxFhir(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  return jsonRequest(`${AIDBOX_URL}/fhir/${path.replace(/^\//, "")}`, {
    ...opts,
    auth: AIDBOX_AUTH,
  });
}

async function mdmboxApi(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  return jsonRequest(`${MDMBOX_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    ...opts,
    auth: MDMBOX_APP_AUTH,
  });
}

async function mdmboxServerFhir(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  return mdmboxApi(`/fhir-server-api/${path.replace(/^\//, "")}`, opts);
}

function assertOk(result: JsonResponse, label: string): JsonResponse {
  if (result.ok) return result;
  throw new Error(`${label} failed: HTTP ${result.status} ${stringifyShort(result.body)}`);
}

// ---------------------------------------------------------------------------
// Patient helpers
// ---------------------------------------------------------------------------
async function readAidboxPatient(id: string) {
  return aidboxFhir(`Patient/${encodeURIComponent(id)}`);
}

async function readMdmboxPatient(id: string) {
  return mdmboxServerFhir(`Patient/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Match + merge flow
// ---------------------------------------------------------------------------
function buildMatchParameters(patient: JsonRecord) {
  return {
    resourceType: "Parameters",
    parameter: [
      { name: "modelId", valueString: MODEL_ID },
      { name: "resource", resource: patient },
      { name: "onlySingleMatch", valueBoolean: true },
    ],
  };
}

async function runMdmboxMatch(patient: JsonRecord) {
  const body = buildMatchParameters(patient);
  const result = await mdmboxApi("/api/fhir/Patient/$match", {
    method: "POST",
    body,
  });
  return { body, result };
}

function firstMatch(bundle: any): JsonRecord | null {
  const entry = Array.isArray(bundle?.entry) ? bundle.entry[0] : undefined;
  if (!entry) return null;
  const resource = entry.resource || {};
  const id = resource.id || extractIdFromFullUrl(entry.fullUrl || "");
  return id ? { ...resource, id } : resource;
}

function buildMergeParameters(opts: {
  source: string;
  target: string;
  entries: JsonRecord[];
  preview?: boolean;
}) {
  return {
    resourceType: "Parameters",
    parameter: [
      { name: "source", valueReference: { reference: opts.source } },
      { name: "target", valueReference: { reference: opts.target } },
      { name: "preview", valueBoolean: opts.preview === true },
      {
        name: "plan",
        resource: {
          resourceType: "Bundle",
          type: "transaction",
          entry: opts.entries,
        },
      },
    ],
  };
}

function buildPrimitiveMergePlan(sourcePatient: JsonRecord, targetPatient: JsonRecord) {
  const sourceId = requiredId(sourcePatient, "source patient");
  const targetId = requiredId(targetPatient, "target patient");
  const mergedTarget = mergeResourcePreferTarget(sourcePatient, targetPatient);

  const putEntry: JsonRecord = {
    resource: mergedTarget,
    request: {
      method: "PUT",
      url: `Patient/${targetId}`,
    },
  };
  const targetEtag = etag(targetPatient);
  if (targetEtag) putEntry.request.ifMatch = targetEtag;

  const deleteEntry: JsonRecord = {
    request: {
      method: "DELETE",
      url: `Patient/${sourceId}`,
    },
  };
  const sourceEtag = etag(sourcePatient);
  if (sourceEtag) deleteEntry.request.ifMatch = sourceEtag;

  return {
    source: `Patient/${sourceId}`,
    target: `Patient/${targetId}`,
    entries: [putEntry, deleteEntry],
    mergedTarget,
  };
}

async function runMdmboxMerge(plan: {
  source: string;
  target: string;
  entries: JsonRecord[];
}) {
  const body = buildMergeParameters({
    source: plan.source,
    target: plan.target,
    entries: plan.entries,
    preview: false,
  });
  const result = await mdmboxApi("/api/fhir/$merge", {
    method: "POST",
    body,
  });
  return { body, result };
}

async function processPatientCreated(notification: unknown, patientRef: JsonRecord) {
  const patientId = requiredId(patientRef, "notification patient");
  const existing = flowByPatientId.get(patientId);
  if (existing && ["no-match", "merged", "error"].includes(existing.status)) {
    addStep(existing, "duplicate delivery ignored", true);
    return existing;
  }

  const flow = existing || newFlow(patientId, notification);
  flow.status = "received";
  flow.notification = notification;
  addStep(flow, "webhook received", true, { patientId });

  try {
    const aidboxPatient = assertOk(
      await readAidboxPatient(patientId),
      `Read Patient/${patientId} from Aidbox`,
    ).body as JsonRecord;
    flow.patient = aidboxPatient;
    addStep(flow, "patient read from Aidbox", true, {
      id: aidboxPatient.id,
      versionId: aidboxPatient.meta?.versionId,
    });

    flow.status = "matching";
    const match = await runMdmboxMatch(aidboxPatient);
    flow.matchRequest = match.body;
    flow.matchResponse = match.result.body;
    assertOk(match.result, "$match");
    addStep(flow, "$match returned", true, {
      onlySingleMatch: true,
      total: (match.result.body as any)?.total,
      entries: Array.isArray((match.result.body as any)?.entry)
        ? (match.result.body as any).entry.length
        : 0,
    });

    const matchedPatientRef = firstMatch(match.result.body);
    if (!matchedPatientRef?.id) {
      flow.status = "no-match";
      addStep(flow, "no match, merge skipped", true);
      return finishFlow(flow);
    }

    const targetRead = assertOk(
      await readMdmboxPatient(matchedPatientRef.id),
      `Read matched Patient/${matchedPatientRef.id} from mdmbox`,
    ).body as JsonRecord;
    flow.matchedPatient = targetRead;
    addStep(flow, "matched patient read from mdmbox", true, {
      id: targetRead.id,
      versionId: targetRead.meta?.versionId,
    });

    const plan = buildPrimitiveMergePlan(aidboxPatient, targetRead);
    addStep(flow, "merge plan built", true, {
      source: plan.source,
      target: plan.target,
      entries: plan.entries.length,
    });

    flow.status = "merging";
    const merge = await runMdmboxMerge(plan);
    flow.mergeRequest = merge.body;
    flow.mergeResponse = merge.result.body;
    assertOk(merge.result, "$merge");
    const mergedPatient = assertOk(
      await readMdmboxPatient(plan.target.replace(/^Patient\//, "")),
      `Read merged ${plan.target} from mdmbox`,
    ).body as JsonRecord;
    flow.mergedPatient = mergedPatient;
    flow.status = "merged";
    addStep(flow, "$merge applied", true, {
      source: plan.source,
      target: plan.target,
      versionId: mergedPatient.meta?.versionId,
    });
    return finishFlow(flow);
  } catch (e) {
    flow.status = "error";
    flow.error = e instanceof Error ? e.message : String(e);
    addStep(flow, "flow failed", false, flow.error);
    return finishFlow(flow);
  }
}

// ---------------------------------------------------------------------------
// Merge strategy
// ---------------------------------------------------------------------------
function mergeResourcePreferTarget(source: JsonRecord, target: JsonRecord): JsonRecord {
  const result: JsonRecord = deepClone(target);
  for (const [key, sourceValue] of Object.entries(source)) {
    if (["resourceType", "id", "meta"].includes(key)) continue;
    result[key] = mergeValuePreferTarget(sourceValue, result[key]);
  }
  result.resourceType = target.resourceType || source.resourceType || "Patient";
  result.id = target.id;
  if (target.meta) result.meta = target.meta;
  return compact(result);
}

function mergeValuePreferTarget(sourceValue: any, targetValue: any): any {
  if (Array.isArray(sourceValue) || Array.isArray(targetValue)) {
    return unionUnique(
      Array.isArray(targetValue) ? targetValue : [],
      Array.isArray(sourceValue) ? sourceValue : [],
    );
  }

  if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
    const result: JsonRecord = deepClone(targetValue);
    for (const [key, value] of Object.entries(sourceValue)) {
      result[key] = mergeValuePreferTarget(value, result[key]);
    }
    return compact(result);
  }

  if (isFilled(targetValue)) return targetValue;
  return deepClone(sourceValue);
}

function unionUnique(targetItems: any[], sourceItems: any[]) {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const item of [...targetItems, ...sourceItems]) {
    if (!isFilled(item)) continue;
    const key = stableStringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(deepClone(item));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Webhook notification parsing
// ---------------------------------------------------------------------------
function extractPatientResources(payload: unknown): JsonRecord[] {
  const found: JsonRecord[] = [];
  const seen = new Set<string>();

  function visit(node: unknown, depth: number) {
    if (depth > 8 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }

    const obj = node as JsonRecord;
    if (obj.resourceType === "Patient") {
      const id = obj.id || extractReferenceId(obj.reference);
      const key = id ? `Patient/${id}` : stableStringify(obj);
      if (!seen.has(key)) {
        seen.add(key);
        found.push(obj);
      }
    }

    for (const key of [
      "resource",
      "notification",
      "notificationEvent",
      "entry",
      "focus",
      "event",
      "events",
      "bundle",
      "body",
    ]) {
      if (obj[key] !== undefined) visit(obj[key], depth + 1);
    }
  }

  visit(payload, 0);
  return found;
}

function extractPatientReferences(payload: unknown): JsonRecord[] {
  const refs: JsonRecord[] = [];
  const seen = new Set<string>();

  function visit(node: unknown, depth: number) {
    if (depth > 8 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const obj = node as JsonRecord;
    const reference = typeof obj.reference === "string" ? obj.reference : undefined;
    const id = reference ? extractReferenceId(reference) : undefined;
    if (id && reference?.startsWith("Patient/") && !seen.has(id)) {
      seen.add(id);
      refs.push({ resourceType: "Patient", id });
    }
    for (const value of Object.values(obj)) visit(value, depth + 1);
  }

  visit(payload, 0);
  return refs;
}

// ---------------------------------------------------------------------------
// Flow log
// ---------------------------------------------------------------------------
function newFlow(patientId: string, notification: unknown): FlowEvent {
  const flow: FlowEvent = {
    id: crypto.randomUUID(),
    patientId,
    status: "received",
    startedAt: now(),
    updatedAt: now(),
    notification,
    steps: [],
  };
  flows.unshift(flow);
  flowByPatientId.set(patientId, flow);
  if (flows.length > 50) flows.splice(50);
  return flow;
}

function addStep(flow: FlowEvent, label: string, ok: boolean, details?: unknown) {
  flow.steps.push({ at: now(), label, ok, details });
  flow.updatedAt = now();
}

function finishFlow(flow: FlowEvent) {
  flow.updatedAt = now();
  return flow;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------
function trimSlash(s: string) {
  return s.replace(/\/$/, "");
}

function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function basicAuth(id: string, secret: string) {
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

function now() {
  return new Date().toISOString();
}

function requiredId(resource: JsonRecord, label: string) {
  const id = String(resource?.id || "").trim();
  if (!id) throw new Error(`${label} must have id`);
  return id;
}

function extractIdFromFullUrl(fullUrl: string) {
  const parts = String(fullUrl || "").split("/");
  return parts[parts.length - 1] || "";
}

function extractReferenceId(reference: unknown) {
  if (typeof reference !== "string") return undefined;
  const match = reference.match(/^Patient\/([^/]+)/);
  return match?.[1];
}

function etag(resource: JsonRecord) {
  const versionId = resource?.meta?.versionId;
  return versionId ? `W/"${versionId}"` : undefined;
}

function isPlainObject(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFilled(value: unknown) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return true;
}

function compact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => compact(v)).filter(isFilled) as T;
  }
  if (isPlainObject(value)) {
    const result: JsonRecord = {};
    for (const [key, item] of Object.entries(value)) {
      const compacted = compact(item);
      if (isFilled(compacted)) result[key] = compacted;
    }
    return result as T;
  }
  return value;
}

function deepClone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stringifyShort(value: unknown) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > 500 ? `${s.slice(0, 500)}...` : s;
}

// ---------------------------------------------------------------------------
// HTTP server (webhook receiver)
// ---------------------------------------------------------------------------
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (pathname === "/health") {
      return Response.json({ ok: true });
    }

    // Inspect recorded flows (debugging aid).
    if (pathname === "/api/events" && req.method === "GET") {
      const patientId = url.searchParams.get("patientId");
      const data = patientId
        ? flows.filter((f) => f.patientId === patientId)
        : flows.slice(0, 20);
      return Response.json({ ok: true, events: data });
    }

    if (pathname === "/api/clear-events" && req.method === "POST") {
      flows.splice(0);
      flowByPatientId.clear();
      return Response.json({ ok: true });
    }

    // The webhook Aidbox calls on Patient/create.
    if (pathname === WEBHOOK_PATH && req.method === "POST") {
      const auth = req.headers.get("authorization") || "";
      if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
        return Response.json({ ok: false, error: "Unauthorized webhook" }, { status: 401 });
      }

      const text = await req.text();
      const payload = safeJson(text);
      const patients = extractPatientResources(payload);
      const refs = patients.length > 0 ? patients : extractPatientReferences(payload);

      if (refs.length === 0) {
        return Response.json({
          ok: true,
          ignored: true,
          reason: "No Patient resource or Patient reference found in webhook payload",
        });
      }

      const processed: FlowEvent[] = [];
      for (const patientRef of refs) {
        processed.push(await processPatientCreated(payload, patientRef));
      }
      return Response.json({
        ok: processed.every((f) => f.status !== "error"),
        processed: processed.map((f) => ({
          id: f.id,
          patientId: f.patientId,
          status: f.status,
        })),
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`mdmbox auto-merge handler app -> http://localhost:${server.port}${WEBHOOK_PATH}`);
console.log(`Aidbox:  ${AIDBOX_URL}`);
console.log(`mdmbox:  ${MDMBOX_URL}`);
