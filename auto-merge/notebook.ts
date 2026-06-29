/**
 * mdmbox-subscription-automerge-app - a single-page example served by Bun.
 *
 * Flow:
 *   browser -> Bun -> Aidbox: create Patient
 *   Aidbox -> Bun: AidboxTopicDestination webhook for Patient/create
 *   Bun -> mdmbox: POST /api/fhir/Patient/$match with onlySingleMatch=true
 *   Bun -> mdmbox: POST /api/$merge when mdmbox returns a match
 */

import matchingModelPatient from "./matching-model-patient.json";

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
  error?: string;
};

const PORT = parseInt(process.env.PORT || "3300", 10);

const AIDBOX_URL = trimSlash(process.env.AIDBOX_URL || "http://localhost:8888");
const PUBLIC_AIDBOX_URL = trimSlash(process.env.PUBLIC_AIDBOX_URL || "http://localhost:8888");
const AIDBOX_AUTH = process.env.AIDBOX_AUTH || "Basic cm9vdDpyb290"; // root:root

const MDMBOX_URL = trimSlash(process.env.MDMBOX_URL || "http://localhost:3003");
const PUBLIC_MDMBOX_URL = trimSlash(process.env.PUBLIC_MDMBOX_URL || "http://localhost:3003");
const MDMBOX_ADMIN_AUTH = process.env.MDMBOX_ADMIN_AUTH || "Basic cm9vdDpyb290"; // root:root

const MODEL_ID = process.env.MODEL_ID || "patient-example";
const MATCH_RESULT_LIMIT = parseInt(process.env.MATCH_RESULT_LIMIT || "1", 10);

const TOPIC_ID = process.env.TOPIC_ID || "mdmbox-patient-created";
const TOPIC_URL =
  process.env.TOPIC_URL || `http://mdmbox.example/SubscriptionTopic/${TOPIC_ID}`;
const DESTINATION_ID = process.env.DESTINATION_ID || "mdmbox-automerge-webhook";
const WEBHOOK_PATH = "/webhooks/patient-created";
const WEBHOOK_ENDPOINT_URL =
  process.env.WEBHOOK_ENDPOINT_URL ||
  `http://host.docker.internal:${PORT}${WEBHOOK_PATH}`;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "aidbox-to-bun-secret";
const WEBHOOK_PROFILE_URL =
  "http://health-samurai.io/fhir/core/StructureDefinition/aidboxtopicdestination-webhookAtLeastOnceProfile";

const MDMBOX_USER_ID = process.env.MDMBOX_USER_ID || "mdmbox-automerge-user";
const MDMBOX_USER_PASSWORD =
  process.env.MDMBOX_USER_PASSWORD || "mdmbox-automerge-password";
const MDMBOX_CLIENT_ID = process.env.MDMBOX_CLIENT_ID || "mdmbox-automerge-client";
const MDMBOX_CLIENT_SECRET =
  process.env.MDMBOX_CLIENT_SECRET || "mdmbox-automerge-secret";
const MDMBOX_ACCESS_POLICY_ID =
  process.env.MDMBOX_ACCESS_POLICY_ID || "mdmbox-automerge-access";
const MDMBOX_APP_AUTH =
  process.env.MDMBOX_APP_AUTH || basicAuth(MDMBOX_CLIENT_ID, MDMBOX_CLIENT_SECRET);

const DIR = import.meta.dir;
const MATCHING_MODEL_TEMPLATE = matchingModelPatient as JsonRecord;

const flows: FlowEvent[] = [];
const flowByPatientId = new Map<string, FlowEvent>();

// ---------------------------------------------------------------------------
// Resource manifests
// ---------------------------------------------------------------------------
function aidboxSubscriptionTopic() {
  return {
    resourceType: "AidboxSubscriptionTopic",
    id: TOPIC_ID,
    url: TOPIC_URL,
    status: "active",
    trigger: [
      {
        resource: "Patient",
        supportedInteraction: ["create"],
        description: "Patient create event used by the mdmbox auto-merge example",
      },
    ],
  };
}

function aidboxTopicDestination() {
  return {
    resourceType: "AidboxTopicDestination",
    id: DESTINATION_ID,
    meta: {
      profile: [WEBHOOK_PROFILE_URL],
    },
    status: "active",
    kind: "webhook-at-least-once",
    topic: TOPIC_URL,
    content: "full-resource",
    includeEntryAction: true,
    includeVersionId: true,
    enableLogging: true,
    parameter: [
      { name: "endpoint", valueUrl: WEBHOOK_ENDPOINT_URL },
      { name: "timeout", valueUnsignedInt: 30 },
      { name: "maxMessagesInBatch", valueUnsignedInt: 1 },
      { name: "header", valueString: `Authorization: Bearer ${WEBHOOK_SECRET}` },
    ],
  };
}

function mdmboxUser() {
  return {
    resourceType: "User",
    id: MDMBOX_USER_ID,
    password: MDMBOX_USER_PASSWORD,
  };
}

function mdmboxClient() {
  return {
    resourceType: "Client",
    id: MDMBOX_CLIENT_ID,
    secret: MDMBOX_CLIENT_SECRET,
    grant_types: ["basic"],
  };
}

function mdmboxAccessPolicy() {
  return {
    resourceType: "AccessPolicy",
    id: MDMBOX_ACCESS_POLICY_ID,
    engine: "allow",
    description: "Allows the Bun auto-merge example client to call mdmbox APIs",
    link: [{ reference: `Client/${MDMBOX_CLIENT_ID}` }],
  };
}

function mdmboxMatchingModel() {
  return {
    ...MATCHING_MODEL_TEMPLATE,
    id: MODEL_ID,
  };
}

function setupManifest() {
  return {
    aidbox: {
      topic: aidboxSubscriptionTopic(),
      destination: aidboxTopicDestination(),
    },
    mdmbox: {
      user: mdmboxUser(),
      client: mdmboxClient(),
      accessPolicy: mdmboxAccessPolicy(),
      matchingModel: mdmboxMatchingModel(),
    },
  };
}

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

async function mdmboxAdmin(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  return jsonRequest(`${MDMBOX_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    ...opts,
    auth: MDMBOX_ADMIN_AUTH,
  });
}

async function mdmboxIamUpsert(
  resourceType: "User" | "Client",
  id: string,
  resource: JsonRecord,
): Promise<JsonResponse> {
  const path = `/api/iam/${resourceType}/${encodeURIComponent(id)}`;
  const existing = await mdmboxAdmin(path);

  if (existing.ok) {
    return mdmboxAdmin(path, { method: "PUT", body: resource });
  }

  if (existing.status === 404) {
    return mdmboxAdmin(`/api/iam/${resourceType}`, { method: "POST", body: resource });
  }

  return existing;
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
// Setup
// ---------------------------------------------------------------------------
async function registerSetupResources() {
  const results: Record<string, JsonResponse | { ok: boolean; skipped?: boolean; reason?: string }> = {};

  results.mdmboxUser = await mdmboxIamUpsert("User", MDMBOX_USER_ID, mdmboxUser());
  results.mdmboxClient = await mdmboxIamUpsert("Client", MDMBOX_CLIENT_ID, mdmboxClient());

  // In this compose stack Aidbox and mdmbox share the same database. The mdmbox
  // IAM API manages User/Client, while AccessPolicy is still a shared Aidbox
  // system resource linked to the mdmbox client.
  results.mdmboxAccessPolicy = await aidboxFhir(
    `AccessPolicy/${MDMBOX_ACCESS_POLICY_ID}`,
    {
      method: "PUT",
      body: mdmboxAccessPolicy(),
    },
  );

  results.matchingModel = await aidboxFhir(`MatchingModel/${encodeURIComponent(MODEL_ID)}`, {
    method: "PUT",
    body: mdmboxMatchingModel(),
  });

  results.topic = await aidboxFhir(`AidboxSubscriptionTopic/${TOPIC_ID}`, {
    method: "PUT",
    body: aidboxSubscriptionTopic(),
  });

  const deleteDestination = await aidboxFhir(`AidboxTopicDestination/${DESTINATION_ID}`, {
    method: "DELETE",
  });
  results.deleteDestination =
    deleteDestination.ok || deleteDestination.status === 404
      ? deleteDestination
      : deleteDestination;

  results.destination = await aidboxFhir("AidboxTopicDestination", {
    method: "POST",
    body: aidboxTopicDestination(),
  });

  results.mdmboxClientAuthCheck = await mdmboxApi("/api/models");

  const ok = Object.values(results).every((r: any) => r.ok || r.status === 404);
  return {
    ok,
    status: ok ? 200 : 502,
    resources: setupManifest(),
    results,
  };
}

// ---------------------------------------------------------------------------
// Patient helpers
// ---------------------------------------------------------------------------
function patientFromInput(input: JsonRecord, fallbackId: string): JsonRecord {
  const id = sanitizeId(input.id || fallbackId);
  const telecom = [
    input.phone ? { system: "phone", value: String(input.phone).trim(), use: "mobile" } : undefined,
    input.email ? { system: "email", value: String(input.email).trim(), use: "home" } : undefined,
  ].filter(Boolean);
  const identifier = input.identifier
    ? [
        {
          system: input.identifierSystem || "https://example.org/mrn",
          value: String(input.identifier).trim(),
        },
      ]
    : undefined;
  const address =
    input.line || input.city || input.state || input.postalCode || input.country
      ? [
          {
            line: input.line ? [String(input.line).trim()] : undefined,
            city: input.city || undefined,
            state: input.state || undefined,
            postalCode: input.postalCode || undefined,
            country: input.country || undefined,
          },
        ]
      : undefined;

  return compact({
    resourceType: "Patient",
    id,
    active: true,
    identifier,
    name: [
      {
        use: "official",
        given: splitGiven(input.given),
        family: input.family || undefined,
      },
    ],
    birthDate: input.birthDate || undefined,
    gender: input.gender || undefined,
    telecom,
    address,
  });
}

async function upsertAidboxPatient(patient: JsonRecord) {
  const id = String(patient.id || "").trim();
  if (!id) throw new Error("Patient.id is required");
  return aidboxFhir(`Patient/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: patient,
  });
}

async function readAidboxPatient(id: string) {
  return aidboxFhir(`Patient/${encodeURIComponent(id)}`);
}

async function readMdmboxPatient(id: string) {
  return mdmboxServerFhir(`Patient/${encodeURIComponent(id)}`);
}

function defaultExistingPatient() {
  return patientFromInput(
    {
      id: "main-jane-doe",
      identifier: "MRN-1000",
      given: "Jane",
      family: "Doe",
      birthDate: "1985-04-12",
      gender: "female",
      phone: "+1-555-0100",
      email: "jane.doe@example.org",
      line: "10 Market Street",
      city: "Boston",
      state: "MA",
      postalCode: "02108",
      country: "US",
    },
    "main-jane-doe",
  );
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
      { name: "count", valueInteger: MATCH_RESULT_LIMIT },
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
  const result = await mdmboxApi("/api/$merge", {
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
    flow.status = "merged";
    addStep(flow, "$merge applied", true, {
      source: plan.source,
      target: plan.target,
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

function sanitizeId(id: string) {
  return String(id)
    .trim()
    .replace(/[^A-Za-z0-9\-.]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function splitGiven(value: unknown) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (pathname === "/" || pathname === "/index.html") {
      return new Response(renderPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (pathname === "/notebook.css") {
      return new Response(Bun.file(`${DIR}/notebook.css`));
    }

    if (pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (pathname === "/api/config" && req.method === "GET") {
      return Response.json({
        aidboxUrl: AIDBOX_URL,
        publicAidboxUrl: PUBLIC_AIDBOX_URL,
        mdmboxUrl: MDMBOX_URL,
        publicMdmboxUrl: PUBLIC_MDMBOX_URL,
        modelId: MODEL_ID,
        webhookEndpointUrl: WEBHOOK_ENDPOINT_URL,
        topicUrl: TOPIC_URL,
        destinationId: DESTINATION_ID,
        mdmboxClientId: MDMBOX_CLIENT_ID,
        resources: setupManifest(),
      });
    }

    if (pathname === "/api/setup" && req.method === "POST") {
      try {
        const result = await registerSetupResources();
        return Response.json(result, { status: result.ok ? 200 : 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    if (pathname === "/api/destination-status" && req.method === "GET") {
      const result = await aidboxFhir(
        `AidboxTopicDestination/${DESTINATION_ID}/$status`,
      );
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }

    if (pathname === "/api/seed-existing-patient" && req.method === "POST") {
      try {
        const patient = defaultExistingPatient();
        const result = await upsertAidboxPatient(patient);
        return Response.json({
          ok: result.ok,
          status: result.status,
          patient,
          response: result.body,
        }, { status: result.ok ? 200 : 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    if (pathname === "/api/create-patient" && req.method === "POST") {
      try {
        const input = await req.json().catch(() => ({}));
        const patient = patientFromInput(input, `incoming-${Date.now()}`);
        const result = await upsertAidboxPatient(patient);
        return Response.json({
          ok: result.ok,
          status: result.status,
          patient,
          response: result.body,
        }, { status: result.ok ? 200 : 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 400 });
      }
    }

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

console.log(`mdmbox subscription auto-merge example -> http://localhost:${server.port}`);
console.log(`Aidbox:  ${AIDBOX_URL}`);
console.log(`mdmbox:  ${MDMBOX_URL}`);
console.log(`Webhook: ${WEBHOOK_ENDPOINT_URL}`);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function renderPage(): string {
  const manifest = JSON.stringify(setupManifest(), null, 2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>mdmbox - subscription auto-merge</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
  <link rel="stylesheet" href="/notebook.css" />
</head>
<body>
  <nav class="navbar">
    <a class="navbar-brand" href="/"><span class="dot"></span><span>mdmbox &times; Aidbox</span></a>
    <span class="navbar-meta">topic: Patient/create - model: ${escapeHtml(MODEL_ID)}</span>
  </nav>

  <main class="page">
    <header class="page-header">
      <h1 class="page-title">Auto-merge new Patient records from an Aidbox webhook</h1>
      <p class="page-subtitle">
        Aidbox sends <code>Patient</code> create events to this Bun app. The handler calls mdmbox
        <code>$match</code> with <code>onlySingleMatch</code> and applies a primitive
        <code>$merge</code> plan when a match is returned.
      </p>
    </header>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Cell 1</span>
        <span class="cell-title">Setup Aidbox topic and mdmbox client</span>
        <span class="cell-badge" id="badge-setup">idle</span>
      </div>
      <div class="cell-body">
        <div class="key-grid">
          <div><span>Aidbox</span><code>${escapeHtml(PUBLIC_AIDBOX_URL)}</code></div>
          <div><span>mdmbox</span><code>${escapeHtml(PUBLIC_MDMBOX_URL)}</code></div>
          <div><span>Webhook</span><code>${escapeHtml(WEBHOOK_ENDPOINT_URL)}</code></div>
        </div>
        <details class="disclosure">
          <summary>Resources created by setup</summary>
          <pre class="code">${escapeHtml(manifest)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-setup">Setup resources</button>
          <button class="btn btn-ghost" id="btn-status">Destination status</button>
          <span class="spinner" id="spin-setup" hidden>Working...</span>
        </div>
        <div id="out-setup"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Cell 2</span>
        <span class="cell-title">Create a Patient and watch the subscription flow</span>
        <span class="cell-badge" id="badge-flow">idle</span>
      </div>
      <div class="cell-body">
        <div class="actions">
          <button class="btn btn-ghost" id="btn-seed">Seed existing Jane Doe</button>
          <button class="btn btn-ghost" id="btn-clear-events">Clear log</button>
          <span class="spinner" id="spin-seed" hidden>Seeding...</span>
        </div>

        <div class="field-row">
          <div class="field">
            <label for="f-id">New patient id</label>
            <input id="f-id" />
          </div>
          <div class="field">
            <label for="f-identifier">Identifier</label>
            <input id="f-identifier" value="MRN-2000" />
          </div>
          <div class="field">
            <label for="f-given">Given</label>
            <input id="f-given" value="Jane" />
          </div>
          <div class="field">
            <label for="f-family">Family</label>
            <input id="f-family" value="Doe" />
          </div>
          <div class="field">
            <label for="f-birthDate">Birthdate</label>
            <input id="f-birthDate" value="1985-04-12" placeholder="YYYY-MM-DD" />
          </div>
          <div class="field">
            <label for="f-gender">Gender</label>
            <select id="f-gender">
              <option value="female">female</option>
              <option value="male">male</option>
              <option value="unknown">unknown</option>
            </select>
          </div>
          <div class="field">
            <label for="f-phone">Phone</label>
            <input id="f-phone" value="+1-555-0101" />
          </div>
          <div class="field">
            <label for="f-email">Email</label>
            <input id="f-email" value="jane.alt@example.org" />
          </div>
          <div class="field">
            <label for="f-city">City</label>
            <input id="f-city" value="Boston" />
          </div>
        </div>

        <details class="disclosure">
          <summary>Patient sent to Aidbox</summary>
          <pre class="code" id="patient-preview"></pre>
        </details>

        <div class="actions">
          <button class="btn btn-primary" id="btn-create">Create Patient in Aidbox</button>
          <span class="spinner" id="spin-create" hidden>Creating...</span>
        </div>

        <div id="flow-summary" class="flow-summary"></div>
        <div id="out-create"></div>
        <div id="out-events"></div>
      </div>
    </section>
  </main>

  <script>${pageScript()}</script>
</body>
</html>`;
}

function pageScript(): string {
  return `
const $ = (id) => document.getElementById(id);
let activePatientId = null;
let pollTimer = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function requestJson(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  });
  const data = await r.json();
  if (!r.ok && data && data.ok === undefined) data.ok = false;
  return data;
}

function setBadge(id, state, text) {
  const el = $(id);
  el.className = "cell-badge " + (state || "");
  el.textContent = text;
}

function renderOutput(hostId, payload) {
  const ok = payload && payload.ok;
  const status = payload && payload.status;
  $(hostId).innerHTML =
    '<div class="output">' +
      '<div class="output-bar">' +
        '<span class="' + (ok ? "status-ok" : "status-err") + '">' + (ok ? "OK" : "HTTP " + (status ?? "error")) + '</span>' +
      '</div>' +
      '<pre class="output-body">' + escapeHtml(JSON.stringify(payload, null, 2)) + '</pre>' +
    '</div>';
}

function patientInput() {
  return {
    id: $("f-id").value.trim(),
    identifier: $("f-identifier").value.trim(),
    given: $("f-given").value.trim(),
    family: $("f-family").value.trim(),
    birthDate: $("f-birthDate").value.trim(),
    gender: $("f-gender").value,
    phone: $("f-phone").value.trim(),
    email: $("f-email").value.trim(),
    city: $("f-city").value.trim(),
  };
}

function compact(value) {
  if (Array.isArray(value)) return value.map(compact).filter(isFilled);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const compacted = compact(item);
      if (isFilled(compacted)) out[key] = compacted;
    }
    return out;
  }
  return value;
}

function isFilled(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function buildPreviewPatient(input) {
  return compact({
    resourceType: "Patient",
    id: input.id,
    active: true,
    identifier: input.identifier ? [{ system: "https://example.org/mrn", value: input.identifier }] : undefined,
    name: [{ use: "official", given: input.given ? input.given.split(/\\s+/) : [], family: input.family }],
    birthDate: input.birthDate,
    gender: input.gender,
    telecom: [
      input.phone ? { system: "phone", value: input.phone, use: "mobile" } : undefined,
      input.email ? { system: "email", value: input.email, use: "home" } : undefined,
    ],
    address: input.city ? [{ city: input.city }] : undefined,
  });
}

function refreshPatientPreview() {
  $("patient-preview").textContent = JSON.stringify(buildPreviewPatient(patientInput()), null, 2);
}

function resetIncomingId() {
  $("f-id").value = "incoming-jane-doe-" + Date.now();
  refreshPatientPreview();
}

function renderFlow(flow) {
  if (!flow) {
    $("flow-summary").innerHTML = '<p class="muted">No webhook flow recorded yet.</p>';
    $("out-events").innerHTML = "";
    return;
  }

  const rows = flow.steps.map((step) =>
    '<tr>' +
      '<td><span class="' + (step.ok ? "status-ok" : "status-err") + '">' + (step.ok ? "ok" : "error") + '</span></td>' +
      '<td>' + escapeHtml(new Date(step.at).toLocaleTimeString()) + '</td>' +
      '<td>' + escapeHtml(step.label) + '</td>' +
      '<td><code>' + escapeHtml(step.details === undefined ? "" : JSON.stringify(step.details)) + '</code></td>' +
    '</tr>'
  ).join("");

  $("flow-summary").innerHTML =
    '<div class="flow-head">' +
      '<span class="grade ' + flow.status + '">' + escapeHtml(flow.status) + '</span>' +
      '<code>Patient/' + escapeHtml(flow.patientId) + '</code>' +
    '</div>' +
    '<table class="results-table"><thead><tr><th>Status</th><th>Time</th><th>Step</th><th>Details</th></tr></thead><tbody>' + rows + '</tbody></table>';

  $("out-events").innerHTML =
    '<div class="output">' +
      '<div class="output-bar"><span class="' + (flow.status === "error" ? "status-err" : "status-ok") + '">flow payload</span></div>' +
      '<pre class="output-body">' + escapeHtml(JSON.stringify(flow, null, 2)) + '</pre>' +
    '</div>';

  setBadge("badge-flow", flow.status === "error" ? "err" : flow.status === "merged" || flow.status === "no-match" ? "ok" : "run", flow.status);
}

async function pollFlow() {
  if (!activePatientId) return;
  const data = await requestJson("/api/events?patientId=" + encodeURIComponent(activePatientId));
  const flow = data.events && data.events[0];
  renderFlow(flow);
  if (flow && ["merged", "no-match", "error"].includes(flow.status)) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

$("btn-setup").addEventListener("click", async () => {
  $("btn-setup").disabled = true;
  $("spin-setup").hidden = false;
  setBadge("badge-setup", "run", "setting up");
  try {
    const data = await requestJson("/api/setup", { method: "POST", body: "{}" });
    renderOutput("out-setup", data);
    setBadge("badge-setup", data.ok ? "ok" : "err", data.ok ? "ready" : "failed");
  } catch (e) {
    $("out-setup").innerHTML = '<div class="error-msg">' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-setup", "err", "failed");
  } finally {
    $("btn-setup").disabled = false;
    $("spin-setup").hidden = true;
  }
});

$("btn-status").addEventListener("click", async () => {
  const data = await requestJson("/api/destination-status");
  renderOutput("out-setup", data);
});

$("btn-seed").addEventListener("click", async () => {
  $("btn-seed").disabled = true;
  $("spin-seed").hidden = false;
  try {
    const data = await requestJson("/api/seed-existing-patient", { method: "POST", body: "{}" });
    renderOutput("out-create", data);
  } finally {
    $("btn-seed").disabled = false;
    $("spin-seed").hidden = true;
  }
});

$("btn-clear-events").addEventListener("click", async () => {
  await requestJson("/api/clear-events", { method: "POST", body: "{}" });
  activePatientId = null;
  renderFlow(null);
  setBadge("badge-flow", "", "idle");
});

$("btn-create").addEventListener("click", async () => {
  $("btn-create").disabled = true;
  $("spin-create").hidden = false;
  setBadge("badge-flow", "run", "creating");
  $("out-events").innerHTML = "";
  try {
    const input = patientInput();
    const data = await requestJson("/api/create-patient", {
      method: "POST",
      body: JSON.stringify(input),
    });
    renderOutput("out-create", data);
    activePatientId = data.patient && data.patient.id;
    renderFlow({ patientId: activePatientId, status: "waiting", steps: [] });
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollFlow, 1200);
    setTimeout(pollFlow, 300);
    resetIncomingId();
  } catch (e) {
    $("out-create").innerHTML = '<div class="error-msg">' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-flow", "err", "failed");
  } finally {
    $("btn-create").disabled = false;
    $("spin-create").hidden = true;
  }
});

["f-id", "f-identifier", "f-given", "f-family", "f-birthDate", "f-gender", "f-phone", "f-email", "f-city"].forEach((id) => {
  $(id).addEventListener("input", refreshPatientPreview);
  $(id).addEventListener("change", refreshPatientPreview);
});

resetIncomingId();
renderFlow(null);
`;
}
