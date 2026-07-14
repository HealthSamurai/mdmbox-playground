/**
 * mdmbox auto-merge notebook.
 */

type JsonRecord = Record<string, any>;

type JsonResponse = {
  ok: boolean;
  status: number;
  url: string;
  body: unknown;
  text: string;
};

const PORT = parseInt(process.env.PORT || "3300", 10);

const AIDBOX_URL = trimSlash(process.env.AIDBOX_URL || "http://localhost:8888");
const PUBLIC_AIDBOX_URL = trimSlash(process.env.PUBLIC_AIDBOX_URL || "http://localhost:8888");
const AIDBOX_AUTH = process.env.AIDBOX_AUTH || "Basic cm9vdDpyb290"; // root:root

const MDMBOX_URL = trimSlash(process.env.MDMBOX_URL || "http://localhost:3003");
const PUBLIC_MDMBOX_URL = trimSlash(process.env.PUBLIC_MDMBOX_URL || "http://localhost:3003");

const MODEL_ID = process.env.MODEL_ID || "patient-example";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "aidbox-to-bun-secret";
const WEBHOOK_ENDPOINT_URL =
  process.env.WEBHOOK_ENDPOINT_URL || "http://localhost:3301/webhooks/patient-created";
const AUTO_MERGE_HANDLER_APP_URL = trimSlash(
  process.env.AUTO_MERGE_HANDLER_APP_URL || originFromUrl(WEBHOOK_ENDPOINT_URL) || "http://localhost:3301",
);
const PUBLIC_AUTO_MERGE_HANDLER_APP_URL = trimSlash(process.env.PUBLIC_AUTO_MERGE_HANDLER_APP_URL || "http://localhost:3301");

const TOPIC_ID = process.env.AIDBOX_TOPIC_ID || "mdmbox-patient-created";
const TOPIC_URL =
  process.env.AIDBOX_TOPIC_URL ||
  `http://mdmbox.example/SubscriptionTopic/${TOPIC_ID}`;
const DESTINATION_ID = process.env.AIDBOX_DESTINATION_ID || "mdmbox-automerge-webhook";

const EXISTING_PATIENT_ID = process.env.EXISTING_PATIENT_ID || "main-jane-doe";
const NEW_PATIENT_ID = process.env.NEW_PATIENT_ID || "incoming-jane-doe";

const DIR = import.meta.dir;

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
      },
    ],
  };
}

function aidboxTopicDestination() {
  return {
    resourceType: "AidboxTopicDestination",
    id: DESTINATION_ID,
    meta: {
      profile: [
        "http://aidbox.app/StructureDefinition/aidboxtopicdestination-webhook-at-least-once",
      ],
    },
    status: "active",
    kind: "webhook-at-least-once",
    topic: TOPIC_URL,
    content: "full-resource",
    includeEntryAction: true,
    includeVersionId: true,
    parameter: [
      {
        name: "endpoint",
        valueUrl: WEBHOOK_ENDPOINT_URL,
      },
      {
        name: "header",
        valueString: `Authorization: Bearer ${WEBHOOK_SECRET}`,
      },
    ],
  };
}

function setupManifest() {
  return {
    aidbox: {
      subscriptionTopic: aidboxSubscriptionTopic(),
      topicDestination: aidboxTopicDestination(),
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

async function autoMergeHandlerAppJson(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  return jsonRequest(`${AUTO_MERGE_HANDLER_APP_URL}${path.startsWith("/") ? path : `/${path}`}`, opts);
}

function wrapResponse(result: JsonResponse, request: unknown) {
  return {
    ok: result.ok,
    status: result.status,
    request,
    response: result.body,
  };
}

// ---------------------------------------------------------------------------
// Notebook actions
// ---------------------------------------------------------------------------
async function putSubscriptionTopic() {
  const topic = aidboxSubscriptionTopic();
  const result = await aidboxFhir(`AidboxSubscriptionTopic/${TOPIC_ID}`, {
    method: "PUT",
    body: topic,
  });
  return wrapResponse(result, {
    method: "PUT",
    url: `${PUBLIC_AIDBOX_URL}/fhir/AidboxSubscriptionTopic/${TOPIC_ID}`,
  });
}

async function postTopicDestination() {
  const destination = aidboxTopicDestination();
  const result = await aidboxFhir("AidboxTopicDestination", {
    method: "POST",
    body: destination,
  });
  return wrapResponse(result, {
    method: "POST",
    url: `${PUBLIC_AIDBOX_URL}/fhir/AidboxTopicDestination`,
  });
}

async function seedExistingPatient() {
  const patient = defaultExistingPatient();
  const result = await aidboxFhir(`Patient/${encodeURIComponent(EXISTING_PATIENT_ID)}`, {
    method: "PUT",
    body: patient,
  });

  return {
    ok: result.ok,
    status: result.status,
    patientId: EXISTING_PATIENT_ID,
    request: {
      method: "PUT",
      url: `${PUBLIC_AIDBOX_URL}/fhir/Patient/${EXISTING_PATIENT_ID}`,
    },
    response: result.body,
  };
}

async function createIncomingPatient() {
  const patient = incomingPatientCreateBody();
  const result = await aidboxFhir("Patient", {
    method: "POST",
    body: patient,
  });
  const response = isPlainObject(result.body) ? (result.body as JsonRecord) : {};
  const patientId = response.id ? String(response.id) : "";

  return {
    ok: result.ok,
    status: result.status,
    patientId,
    request: { method: "POST", url: `${PUBLIC_AIDBOX_URL}/fhir/Patient` },
    response: result.body,
  };
}

async function readEvents(patientId: string) {
  const id = String(patientId || "").trim();
  if (!id) return { ok: false, status: 400, error: "Patient id is required." };

  const response = await autoMergeHandlerAppJson(`/api/events?patientId=${encodeURIComponent(id)}`);
  const events = Array.isArray((response.body as any)?.events)
    ? ((response.body as any).events as JsonRecord[])
    : [];
  const flow = events[0] || null;
  const targetId = targetIdFromFlow(flow);
  const summary = summarizeFlow(flow, id, targetId);
  return {
    ok: response.ok,
    status: response.status,
    patientId: id,
    targetId,
    summary,
    request: {
      method: "GET",
      url: `${PUBLIC_AUTO_MERGE_HANDLER_APP_URL}/api/events?patientId=${encodeURIComponent(id)}`,
    },
    response: response.body,
  };
}

async function readAidboxPatient(id: string) {
  const result = await aidboxFhir(`Patient/${encodeURIComponent(id)}`);
  return {
    ok: result.ok,
    status: result.status,
    request: { method: "GET", url: `${PUBLIC_AIDBOX_URL}/fhir/Patient/${id}` },
    response: result.body,
  };
}

// ---------------------------------------------------------------------------
// Patient fixtures
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

function defaultExistingPatient() {
  return patientFromInput(
    {
      id: EXISTING_PATIENT_ID,
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
    EXISTING_PATIENT_ID,
  );
}

function defaultNewPatient(id = NEW_PATIENT_ID) {
  return patientFromInput(
    {
      id,
      identifier: "MRN-2000",
      given: "Jane",
      family: "Doe",
      birthDate: "1985-04-12",
      gender: "female",
      phone: "+1-555-0101",
      email: "jane.alt@example.org",
      city: "Boston",
    },
    id,
  );
}

function incomingPatientCreateBody() {
  const patient = defaultNewPatient(NEW_PATIENT_ID);
  delete patient.id;
  return patient;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------
function trimSlash(s: string) {
  return s.replace(/\/$/, "");
}

function originFromUrl(raw: string) {
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

function safeJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function splitGiven(value: unknown) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function sanitizeId(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function targetIdFromFlow(flow: JsonRecord | null) {
  const matchedId = flow?.matchedPatient?.id;
  if (matchedId) return String(matchedId);
  const mergedId = flow?.mergedPatient?.id;
  if (mergedId) return String(mergedId);

  const targetParam = Array.isArray(flow?.mergeRequest?.parameter)
    ? flow.mergeRequest.parameter.find((p: JsonRecord) => p?.name === "target")
    : undefined;
  const reference = targetParam?.valueReference?.reference;
  return typeof reference === "string" ? reference.replace(/^Patient\//, "") : undefined;
}

function summarizeFlow(flow: JsonRecord | null, patientId: string, targetId?: string) {
  if (!flow) {
    return {
      status: "waiting",
      source: `Patient/${patientId}`,
    };
  }

  return compact({
    status: typeof flow.status === "string" ? flow.status : "received",
    source: `Patient/${patientId}`,
    target: targetId ? `Patient/${targetId}` : undefined,
    startedAt: flow.startedAt,
    updatedAt: flow.updatedAt,
    match: summarizeMatch(flow),
    merge: summarizeMerge(flow),
    mergedPatient: summarizePatient(flow.mergedPatient),
    steps: summarizeSteps(flow),
  });
}

function summarizeSteps(flow: JsonRecord) {
  return arrayRecords(flow.steps).map((step) =>
    compact({
      at: step.at,
      label: step.label,
      ok: step.ok,
      details: step.details,
    }),
  );
}

function summarizeMatch(flow: JsonRecord) {
  const matchResponse = isPlainObject(flow.matchResponse) ? flow.matchResponse : {};
  const entries = arrayRecords(matchResponse.entry);
  const first = entries[0] || {};
  const search = isPlainObject(first.search) ? first.search : {};
  const searchExtensions = arrayRecords(search.extension);
  const detailsExtension = searchExtensions.find(
    (ext) => ext.url === "https://mdmbox.health-samurai.io/fhir/StructureDefinition/match-details",
  );
  const details: JsonRecord = {};

  for (const item of arrayRecords(detailsExtension?.extension)) {
    const key = typeof item.url === "string" ? item.url : "";
    const value = scalarExtensionValue(item);
    if (key && value !== undefined) details[key] = value;
  }

  return compact({
    total: matchResponse.total,
    entries: entries.length,
    targetId: isPlainObject(first.resource) ? first.resource.id : undefined,
    score: roundScore(search.score),
    grade: scalarExtensionValue(
      searchExtensions.find((ext) => ext.url === "http://hl7.org/fhir/StructureDefinition/match-grade"),
    ),
    weight: scalarExtensionValue(
      searchExtensions.find(
        (ext) => ext.url === "https://mdmbox.health-samurai.io/fhir/StructureDefinition/match-weight",
      ),
    ),
    details,
  });
}

function summarizeMerge(flow: JsonRecord) {
  const mergedPatient = isPlainObject(flow.mergedPatient) ? flow.mergedPatient : {};
  return compact({
    status: flow.status,
    outcome: mergeOutcomeText(flow.mergeResponse),
    targetId: mergedPatient.id,
    versionId: isPlainObject(mergedPatient.meta) ? mergedPatient.meta.versionId : undefined,
  });
}

function summarizePatient(value: unknown) {
  if (!isPlainObject(value)) return undefined;
  return compact({
    id: value.id,
    versionId: isPlainObject(value.meta) ? value.meta.versionId : undefined,
    identifiers: arrayRecords(value.identifier).map((identifier) => identifier.value).filter(Boolean),
    phones: arrayRecords(value.telecom)
      .filter((telecom) => telecom.system === "phone")
      .map((telecom) => telecom.value)
      .filter(Boolean),
    emails: arrayRecords(value.telecom)
      .filter((telecom) => telecom.system === "email")
      .map((telecom) => telecom.value)
      .filter(Boolean),
    addressCount: Array.isArray(value.address) ? value.address.length : undefined,
  });
}

function mergeOutcomeText(value: unknown) {
  if (!isPlainObject(value)) return undefined;
  const outcomeParam = arrayRecords(value.parameter).find((param) => param.name === "outcome");
  const outcome = isPlainObject(outcomeParam?.resource) ? outcomeParam.resource : {};
  const issue = arrayRecords(outcome.issue)[0] || {};
  const details = isPlainObject(issue.details) ? issue.details : {};
  return typeof details.text === "string" ? details.text : undefined;
}

function scalarExtensionValue(value: unknown) {
  if (!isPlainObject(value)) return undefined;
  for (const key of ["valueCode", "valueDecimal", "valueInteger", "valueString", "valueBoolean"]) {
    if (value[key] !== undefined) return value[key];
  }
  return undefined;
}

function roundScore(value: unknown) {
  return typeof value === "number" ? Math.round(value * 1_000_000) / 1_000_000 : value;
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
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
        autoMergeHandlerAppUrl: AUTO_MERGE_HANDLER_APP_URL,
        publicAutoMergeHandlerAppUrl: PUBLIC_AUTO_MERGE_HANDLER_APP_URL,
        webhookEndpointUrl: WEBHOOK_ENDPOINT_URL,
        modelId: MODEL_ID,
        existingPatientId: EXISTING_PATIENT_ID,
        incomingPatientIdPrefix: NEW_PATIENT_ID,
        resources: setupManifest(),
      });
    }

    if (pathname === "/api/subscription-topic" && req.method === "POST") {
      try {
        const result = await putSubscriptionTopic();
        return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    if (pathname === "/api/topic-destination" && req.method === "POST") {
      try {
        const result = await postTopicDestination();
        return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    if (pathname === "/api/existing-patient" && req.method === "POST") {
      try {
        const result = await seedExistingPatient();
        return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    if (pathname === "/api/incoming-patient" && req.method === "POST") {
      try {
        const result = await createIncomingPatient();
        return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    if (pathname === "/api/proxy-events" && req.method === "GET") {
      try {
        const result = await readEvents(url.searchParams.get("patientId") || "");
        return Response.json(result, { status: (result as any).ok ? 200 : (result as any).status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    if (pathname === "/api/patient" && req.method === "GET") {
      const id = url.searchParams.get("id") || "";
      const result = await readAidboxPatient(id);
      return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`mdmbox auto-merge notebook -> http://localhost:${server.port}`);
console.log(`Aidbox:  ${AIDBOX_URL}`);
console.log(`mdmbox:  ${MDMBOX_URL}`);
console.log(`auto-merge handler app:   ${AUTO_MERGE_HANDLER_APP_URL}`);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function renderPage(): string {
  const topicJson = JSON.stringify(aidboxSubscriptionTopic(), null, 2);
  const destinationJson = JSON.stringify(aidboxTopicDestination(), null, 2);
  const existingJson = JSON.stringify(defaultExistingPatient(), null, 2);
  const newJson = JSON.stringify(incomingPatientCreateBody(), null, 2);
  const topicUrl = `${PUBLIC_AIDBOX_URL}/fhir/AidboxSubscriptionTopic/${TOPIC_ID}`;
  const destinationUrl = `${PUBLIC_AIDBOX_URL}/fhir/AidboxTopicDestination`;
  const existingUrl = `${PUBLIC_AIDBOX_URL}/fhir/Patient/${EXISTING_PATIENT_ID}`;
  const incomingUrl = `${PUBLIC_AIDBOX_URL}/fhir/Patient`;
  const eventsUrl = `${PUBLIC_AUTO_MERGE_HANDLER_APP_URL}/api/events?patientId={id}`;
  const patientUrl = `${PUBLIC_AIDBOX_URL}/fhir/Patient/{id}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>mdmbox - auto merge</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
  <link rel="stylesheet" href="/notebook.css" />
</head>
<body>
  <nav class="navbar">
    <a class="navbar-brand" href="/"><span class="dot"></span><span>mdmbox &times; Aidbox</span></a>
    <span class="navbar-meta">auto-merge handler app</span>
  </nav>

  <main class="page">
    <header class="page-header">
      <h1 class="page-title">Auto-merge REST notebook</h1>
      <p class="page-subtitle">
        Run the requests in order.
      </p>
    </header>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 1</span>
        <span class="cell-title"><code>PUT ${escapeHtml(topicUrl)}</code></span>
        <span class="cell-badge" id="badge-1">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Create a subscription topic for the <code>Patient/create</code> event.
        </p>
        <details class="disclosure">
          <summary>Body</summary>
          <pre class="code">${escapeHtml(topicJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-1">Send request</button>
          <span class="spinner" id="spin-1" hidden>Sending...</span>
        </div>
        <div id="out-1"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 2</span>
        <span class="cell-title"><code>POST ${escapeHtml(destinationUrl)}</code></span>
        <span class="cell-badge" id="badge-2">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Create a webhook destination for that topic.
        </p>
        <details class="disclosure">
          <summary>Body</summary>
          <pre class="code">${escapeHtml(destinationJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-2">Send request</button>
          <span class="spinner" id="spin-2" hidden>Sending...</span>
        </div>
        <div id="out-2"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 3</span>
        <span class="cell-title"><code>PUT ${escapeHtml(existingUrl)}</code></span>
        <span class="cell-badge" id="badge-3">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Create the existing Patient that should survive the merge.
        </p>
        <details class="disclosure">
          <summary>Body</summary>
          <pre class="code">${escapeHtml(existingJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-3">Send request</button>
          <span class="spinner" id="spin-3" hidden>Sending...</span>
        </div>
        <div id="out-3"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 4</span>
        <span class="cell-title"><code>POST ${escapeHtml(incomingUrl)}</code></span>
        <span class="cell-badge" id="badge-4">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Create a new duplicate Patient in Aidbox.
        </p>
        <details class="disclosure">
          <summary>Body</summary>
          <pre class="code">${escapeHtml(newJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-4">Send request</button>
          <span class="spinner" id="spin-4" hidden>Sending...</span>
        </div>
        <div id="out-4"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 5</span>
        <span class="cell-title"><code>GET ${escapeHtml(eventsUrl)}</code></span>
        <span class="cell-badge" id="badge-5">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Read events for the Patient created in Step 4.
        </p>
        <div class="field-row one">
          <div class="field">
            <label for="f-patient">Incoming Patient id</label>
            <input id="f-patient" placeholder="created in Step 4" />
          </div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" id="btn-5">Send request</button>
          <span class="spinner" id="spin-5" hidden>Sending...</span>
        </div>
        <div id="out-5"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 6</span>
        <span class="cell-title"><code>GET ${escapeHtml(patientUrl)}</code></span>
        <span class="cell-badge" id="badge-6">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Read the merged target Patient from Aidbox.
        </p>
        <div class="field-row one">
          <div class="field">
            <label for="f-target">Merged target id</label>
            <input id="f-target" placeholder="from Step 5 response" />
          </div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" id="btn-6">Send request</button>
          <span class="spinner" id="spin-6" hidden>Sending...</span>
        </div>
        <div id="out-6"></div>
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function requestJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  const data = await r.json();
  if (!r.ok && data && data.ok === undefined) data.ok = false;
  return data;
}

function setBadge(id, state, text) {
  const el = $(id);
  el.className = "cell-badge " + (state || "");
  el.textContent = text;
}

function outputHtml(payload, label) {
  const ok = payload && payload.ok;
  const status = payload && payload.status;
  return (
    '<div class="output">' +
      '<div class="output-bar">' +
        '<span class="' + (ok ? "status-ok" : "status-err") + '">' + (ok ? (label || "OK") : "HTTP " + (status == null ? "error" : status)) + '</span>' +
      '</div>' +
      '<pre class="output-body">' + escapeHtml(JSON.stringify(payload, null, 2)) + '</pre>' +
    '</div>'
  );
}

function renderOutput(hostId, payload, label) {
  $(hostId).innerHTML = outputHtml(payload, label);
}

function renderEventsOutput(hostId, payload) {
  const label = payload && payload.targetId ? "full response, target " + payload.targetId : "full response";
  if (!payload || !payload.ok) {
    renderOutput(hostId, payload, label);
    return;
  }
  $(hostId).innerHTML = eventsSummaryHtml(payload) + outputHtml(payload, label);
}

function eventsSummaryHtml(payload) {
  const summary = payload.summary || {};
  const match = summary.match || {};
  const merge = summary.merge || {};
  const patient = summary.mergedPatient || {};
  const steps = Array.isArray(summary.steps) ? summary.steps : [];
  const status = summary.status || "waiting";
  const matchText = match.total == null ? "not returned" : String(match.total) + " match" + (match.total === 1 ? "" : "es");
  const mergeText = merge.versionId ? "version " + merge.versionId : displayValue(merge.status);

  return (
    '<div class="flow-card">' +
      '<div class="flow-head">' +
        '<span class="grade ' + cssToken(status) + '">' + escapeHtml(status) + '</span>' +
        '<code>' + escapeHtml(summary.source || ("Patient/" + (payload.patientId || ""))) + '</code>' +
        '<span class="flow-arrow">to</span>' +
        '<code>' + escapeHtml(summary.target || (payload.targetId ? "Patient/" + payload.targetId : "waiting")) + '</code>' +
      '</div>' +
      '<div class="key-grid">' +
        summaryCell("Match", matchText) +
        summaryCell("Grade", match.grade || "n/a") +
        summaryCell("Score", match.score == null ? "n/a" : match.score) +
        summaryCell("$merge", mergeText) +
      '</div>' +
      renderFlowSteps(steps) +
      renderMatchDetails(match.details) +
      renderPills("Merged identifiers", patient.identifiers) +
      renderPills("Merged phones", patient.phones) +
      renderPills("Merged emails", patient.emails) +
      (merge.outcome ? '<p class="flow-outcome">' + escapeHtml(merge.outcome) + '</p>' : '') +
    '</div>'
  );
}

function summaryCell(label, value) {
  const text = displayValue(value);
  return '<div><span>' + escapeHtml(label) + '</span><code title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</code></div>';
}

function renderFlowSteps(steps) {
  if (!steps.length) return '<p class="muted flow-detail">No event has been recorded yet.</p>';
  return (
    '<ol class="flow-steps">' +
      steps.map((step) => {
        const details = step.details
          ? '<pre class="flow-step-details">' + escapeHtml(JSON.stringify(step.details, null, 2)) + '</pre>'
          : '';
        return (
          '<li class="flow-step ' + (step.ok === false ? "err" : "ok") + '">' +
            '<span class="flow-step-dot"></span>' +
            '<div>' +
              '<div class="flow-step-title">' + escapeHtml(step.label || "step") + '</div>' +
              '<div class="flow-step-time">' + escapeHtml(step.at || "") + '</div>' +
              details +
            '</div>' +
          '</li>'
        );
      }).join('') +
    '</ol>'
  );
}

function renderMatchDetails(details) {
  const keys = details && typeof details === "object" ? Object.keys(details) : [];
  if (!keys.length) return '';
  return (
    '<div class="flow-detail">' +
      '<div class="flow-step-title">Match weights</div>' +
      '<div class="pill-list">' +
        keys.map((key) => '<span class="pill"><b>' + escapeHtml(key) + '</b> ' + escapeHtml(displayValue(details[key])) + '</span>').join('') +
      '</div>' +
    '</div>'
  );
}

function renderPills(title, values) {
  if (!Array.isArray(values) || !values.length) return '';
  return (
    '<div class="flow-detail">' +
      '<div class="flow-step-title">' + escapeHtml(title) + '</div>' +
      '<div class="pill-list">' +
        values.map((value) => '<span class="pill">' + escapeHtml(displayValue(value)) + '</span>').join('') +
      '</div>' +
    '</div>'
  );
}

function displayValue(value) {
  if (value === undefined || value === null || value === "") return "n/a";
  return String(value);
}

function cssToken(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9-]+/g, "-") || "unknown";
}

async function runStep(n, run, runningText, okText) {
  $("btn-" + n).disabled = true;
  $("spin-" + n).hidden = false;
  setBadge("badge-" + n, "run", runningText);
  let data;
  try {
    data = await run();
    renderOutput("out-" + n, data, typeof okText === "function" ? okText(data) : okText);
    setBadge("badge-" + n, data.ok ? "ok" : "err", data.ok ? "done" : "failed");
  } catch (e) {
    $("out-" + n).innerHTML = '<div class="error-msg">' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-" + n, "err", "failed");
  } finally {
    $("btn-" + n).disabled = false;
    $("spin-" + n).hidden = true;
  }
  return data;
}

async function runEvents() {
  const patientId = $("f-patient").value.trim();
  if (!patientId) {
    $("out-5").innerHTML = '<div class="error-msg">Run Step 4 first, or paste an incoming Patient id.</div>';
    setBadge("badge-5", "err", "missing id");
    return null;
  }

  $("btn-5").disabled = true;
  $("spin-5").hidden = false;
  setBadge("badge-5", "run", "reading");
  try {
    const data = await requestJson("/api/proxy-events?patientId=" + encodeURIComponent(patientId));
    renderEventsOutput("out-5", data);
    if (data && data.targetId) $("f-target").value = data.targetId;
    setBadge("badge-5", data.ok ? "ok" : "err", data.ok ? "done" : "failed");
    return data;
  } catch (e) {
    $("out-5").innerHTML = '<div class="error-msg">' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-5", "err", "failed");
    return null;
  } finally {
    $("btn-5").disabled = false;
    $("spin-5").hidden = true;
  }
}

async function runReadPatient() {
  const patientId = $("f-target").value.trim();
  if (!patientId) {
    $("out-6").innerHTML = '<div class="error-msg">Run Step 5 first, or paste a Patient id.</div>';
    setBadge("badge-6", "err", "missing id");
    return null;
  }

  $("btn-6").disabled = true;
  $("spin-6").hidden = false;
  setBadge("badge-6", "run", "reading");
  try {
    const data = await requestJson("/api/patient?id=" + encodeURIComponent(patientId));
    renderOutput("out-6", data, "patient");
    setBadge("badge-6", data.ok ? "ok" : "err", data.ok ? "done" : "failed");
    return data;
  } catch (e) {
    $("out-6").innerHTML = '<div class="error-msg">' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-6", "err", "failed");
    return null;
  } finally {
    $("btn-6").disabled = false;
    $("spin-6").hidden = true;
  }
}

$("btn-1").addEventListener("click", () =>
  runStep(1, () => requestJson("/api/subscription-topic", { method: "POST", body: "{}" }), "sending", "done"));

$("btn-2").addEventListener("click", () =>
  runStep(2, () => requestJson("/api/topic-destination", { method: "POST", body: "{}" }), "sending", "done"));

$("btn-3").addEventListener("click", () =>
  runStep(3, () => requestJson("/api/existing-patient", { method: "POST", body: "{}" }), "sending", "done"));

$("btn-4").addEventListener("click", async () => {
  const data = await runStep(
    4,
    () => requestJson("/api/incoming-patient", { method: "POST", body: "{}" }),
    "sending",
    (d) => d.patientId ? "created " + d.patientId : "done",
  );
  if (data && data.ok && data.patientId) {
    $("f-patient").value = data.patientId;
  }
});

$("btn-5").addEventListener("click", runEvents);
$("btn-6").addEventListener("click", runReadPatient);
`;
}
