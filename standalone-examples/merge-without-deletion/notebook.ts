/**
 * mdmbox merge-without-deletion notebook.
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
const MDMBOX_AUTH = process.env.MDMBOX_AUTH || "Basic cm9vdDpyb290"; // root:root

// The target survives the merge, the source is deactivated.
const TARGET_ID = process.env.TARGET_ID || "1";
const SOURCE_ID = process.env.SOURCE_ID || "2";

const DIR = import.meta.dir;

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function jsonRequest(
  url: string,
  opts: { method?: string; auth?: string; body?: unknown } = {},
): Promise<JsonResponse> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.auth) headers.authorization = opts.auth;

  // redirect:"manual" — never follow a redirect. mdmbox returns 302 -> "/" when
  // it is not activated / needs login; following it would replay the request
  // against "/" in a loop ("redirected too many times"). Surface it instead.
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    redirect: "manual",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") || "";
    return {
      ok: false,
      status: res.status,
      url,
      body: {
        error:
          "Server redirected this API call (HTTP " +
          res.status +
          " -> " +
          (location || "/") +
          "). The service is most likely not activated or requires login. " +
          "Activate Aidbox at " +
          PUBLIC_AIDBOX_URL +
          " and mdmbox at " +
          PUBLIC_MDMBOX_URL +
          ", then retry.",
      },
      text,
    };
  }

  return { ok: res.ok, status: res.status, url, body: safeJson(text), text };
}

function mdmbox(path: string, opts: { method?: string; body?: unknown } = {}) {
  return jsonRequest(`${MDMBOX_URL}${path.startsWith("/") ? path : `/${path}`}`, {
    ...opts,
    auth: MDMBOX_AUTH,
  });
}

// Patients are created and read through Aidbox's FHIR API. (mdmbox() above is
// used only for the /api/$merge call.)
function aidboxFhir(path: string, opts: { method?: string; body?: unknown } = {}) {
  return jsonRequest(`${AIDBOX_URL}/fhir/${path.replace(/^\//, "")}`, {
    ...opts,
    auth: AIDBOX_AUTH,
  });
}

// ---------------------------------------------------------------------------
// Sample patients (so the example is runnable with five clicks)
// ---------------------------------------------------------------------------
function targetPatient(): JsonRecord {
  return {
    resourceType: "Patient",
    id: TARGET_ID,
    active: true,
    identifier: [{ system: "https://example.org/mrn", value: "MRN-1000" }],
    name: [{ use: "official", given: ["Jane"], family: "Doe" }],
    birthDate: "1985-04-12",
    gender: "female",
    telecom: [{ system: "email", value: "jane.doe@example.org", use: "home" }],
    address: [{ city: "Boston", state: "MA", country: "US" }],
  };
}

function sourcePatient(): JsonRecord {
  return {
    resourceType: "Patient",
    id: SOURCE_ID,
    active: true,
    identifier: [{ system: "https://example.org/mrn", value: "MRN-2000" }],
    name: [{ use: "official", given: ["Jane"], family: "Doe" }],
    birthDate: "1985-04-12",
    gender: "female",
    telecom: [{ system: "phone", value: "+1-555-0101", use: "mobile" }],
    address: [{ city: "Boston", state: "MA", country: "US" }],
  };
}

// Step 1 / Step 2: create a patient in Aidbox (PUT with explicit id = upsert).
async function putPatient(patient: JsonRecord) {
  const id = requiredId(patient, "patient");
  const result = await aidboxFhir(`Patient/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: patient,
  });
  return {
    ok: result.ok,
    status: result.status,
    request: { method: "PUT", url: `Patient/${id}`, body: patient },
    response: result.body,
  };
}

// Step 4 / Step 5: read a patient back from Aidbox.
async function getPatient(id: string) {
  const result = await aidboxFhir(`Patient/${encodeURIComponent(id)}`);
  return {
    ok: result.ok,
    status: result.status,
    request: { method: "GET", url: `Patient/${id}` },
    response: result.body,
  };
}

// ---------------------------------------------------------------------------
// Merge plan: deactivate the source (active:false + replaced-by), don't delete
// ---------------------------------------------------------------------------
// Add a Patient.link (idempotent) of the given type pointing at otherId.
function withPatientLink(resource: JsonRecord, type: string, otherId: string): JsonRecord {
  const next = deepClone(resource);
  const link = { other: { reference: `Patient/${otherId}` }, type };
  const links = Array.isArray(next.link) ? next.link : [];
  const already = links.some(
    (l: JsonRecord) => l?.type === type && l?.other?.reference === `Patient/${otherId}`,
  );
  next.link = already ? links : [...links, link];
  return next;
}

function deactivateSource(source: JsonRecord, targetId: string): JsonRecord {
  // The retired source: active:false + "replaced-by" -> the surviving target.
  const next = withPatientLink(source, "replaced-by", targetId);
  next.active = false;
  return next;
}

function buildMergePlan(source: JsonRecord, target: JsonRecord) {
  const sourceId = requiredId(source, "source patient");
  const targetId = requiredId(target, "target patient");
  // Surviving target gets a "replaces" link back to the retired source — the
  // canonical reciprocal of the source's "replaced-by" link.
  const mergedTarget = withPatientLink(mergeResourcePreferTarget(source, target), "replaces", sourceId);
  const deactivatedSource = deactivateSource(source, targetId);

  const targetPut: JsonRecord = {
    resource: mergedTarget,
    request: { method: "PUT", url: `Patient/${targetId}` },
  };
  const targetEtag = etag(target);
  if (targetEtag) targetPut.request.ifMatch = targetEtag;

  // Instead of DELETE: PUT the source back with active:false + replaced-by link.
  const sourcePut: JsonRecord = {
    resource: deactivatedSource,
    request: { method: "PUT", url: `Patient/${sourceId}` },
  };
  const sourceEtag = etag(source);
  if (sourceEtag) sourcePut.request.ifMatch = sourceEtag;

  return {
    source: `Patient/${sourceId}`,
    target: `Patient/${targetId}`,
    entries: [targetPut, sourcePut],
    mergedTarget,
    deactivatedSource,
  };
}

function buildMergeParameters(opts: { source: string; target: string; entries: JsonRecord[]; preview: boolean }) {
  return {
    resourceType: "Parameters",
    parameter: [
      { name: "source", valueReference: { reference: opts.source } },
      { name: "target", valueReference: { reference: opts.target } },
      { name: "preview", valueBoolean: opts.preview },
      { name: "plan", resource: { resourceType: "Bundle", type: "transaction", entry: opts.entries } },
    ],
  };
}

// Step 3: Page -> Bun -> mdmbox $merge.
async function runMerge(input: JsonRecord) {
  const sourceId = String(input.sourceId || SOURCE_ID).trim();
  const targetId = String(input.targetId || TARGET_ID).trim();
  if (!sourceId || !targetId) {
    return { ok: false, status: 400, error: "Both source and target Patient ids are required." };
  }

  const sourceRead = await aidboxFhir(`Patient/${encodeURIComponent(sourceId)}`);
  if (!sourceRead.ok) return { ok: false, status: sourceRead.status, error: `Source Patient/${sourceId} not found in Aidbox`, response: sourceRead.body };
  const targetRead = await aidboxFhir(`Patient/${encodeURIComponent(targetId)}`);
  if (!targetRead.ok) return { ok: false, status: targetRead.status, error: `Target Patient/${targetId} not found in Aidbox`, response: targetRead.body };

  const plan = buildMergePlan(sourceRead.body as JsonRecord, targetRead.body as JsonRecord);
  const body = buildMergeParameters({ source: plan.source, target: plan.target, entries: plan.entries, preview: false });

  const url = `${MDMBOX_URL}/api/$merge`;
  const started = performance.now();
  const result = await mdmbox("/api/$merge", { method: "POST", body });
  const elapsedMs = Math.round(performance.now() - started);

  return {
    ok: result.ok,
    status: result.status,
    via: url,
    elapsedMs,
    request: { method: "POST", url: "/api/$merge", body },
    response: result.body,
  };
}

// ---------------------------------------------------------------------------
// Merge strategy (target wins scalars, arrays union, fill gaps from source)
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

function requiredId(resource: JsonRecord, label: string) {
  const id = String(resource?.id || "").trim();
  if (!id) throw new Error(`${label} must have id`);
  return id;
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
      return new Response(renderPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
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
        targetId: TARGET_ID,
        sourceId: SOURCE_ID,
      });
    }

    // Step 1 & 2: POST (PUT/upsert) a patient into Aidbox.
    if (pathname === "/api/put-patient" && req.method === "POST") {
      try {
        const which = url.searchParams.get("which");
        const patient = which === "source" ? sourcePatient() : targetPatient();
        const result = await putPatient(patient);
        return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    // Step 3: POST $merge.
    if (pathname === "/api/merge" && req.method === "POST") {
      try {
        const input = await req.json().catch(() => ({}));
        const result = await runMerge(input);
        return Response.json(result, { status: (result as any).ok ? 200 : (result as any).status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    // Step 4 & 5: GET a patient back from Aidbox.
    if (pathname === "/api/patient" && req.method === "GET") {
      const id = url.searchParams.get("id") || "";
      const result = await getPatient(id);
      return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`mdmbox merge-inactive example -> http://localhost:${server.port}`);
console.log(`Aidbox: ${AIDBOX_URL}  (create/read patients)`);
console.log(`mdmbox: ${MDMBOX_URL}  ($merge)`);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function renderPage(): string {
  const targetJson = JSON.stringify(targetPatient(), null, 2);
  const sourceJson = JSON.stringify(sourcePatient(), null, 2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>mdmbox - merge keeps source inactive</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
  <link rel="stylesheet" href="/notebook.css" />
</head>
<body>
  <nav class="navbar">
    <a class="navbar-brand" href="/"><span class="dot"></span><span>mdmbox &times; $merge</span></a>
    <span class="navbar-meta">deactivate source on merge</span>
  </nav>

  <main class="page">
    <header class="page-header">
      <h1 class="page-title"><code>$merge</code> without deletion</h1>
      <p class="page-subtitle">
        Five steps: create two patients, run mdmbox <code>$merge</code>, then read both
        back. The plan <strong>PUTs the source with <code>active:false</code></strong> and a
        <code>replaced-by</code> link to the target &mdash; the duplicate is retired, not
        deleted, so it stays queryable for audit/history. <code>Patient/${escapeHtml(TARGET_ID)}</code>
        survives, <code>Patient/${escapeHtml(SOURCE_ID)}</code> is deactivated.
      </p>
    </header>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 1</span>
        <span class="cell-title">POST <code>Patient/${escapeHtml(TARGET_ID)}</code> (target, survives)</span>
        <span class="cell-badge" id="badge-1">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">Creates the surviving target patient in Aidbox.</p>
        <details class="disclosure">
          <summary>Request body</summary>
          <pre class="code">${escapeHtml(targetJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-1">POST Patient/${escapeHtml(TARGET_ID)}</button>
          <span class="spinner" id="spin-1" hidden>Posting...</span>
        </div>
        <div id="out-1"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 2</span>
        <span class="cell-title">POST <code>Patient/${escapeHtml(SOURCE_ID)}</code> (source, duplicate)</span>
        <span class="cell-badge" id="badge-2">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">Creates the duplicate source patient in Aidbox.</p>
        <details class="disclosure">
          <summary>Request body</summary>
          <pre class="code">${escapeHtml(sourceJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-2">POST Patient/${escapeHtml(SOURCE_ID)}</button>
          <span class="spinner" id="spin-2" hidden>Posting...</span>
        </div>
        <div id="out-2"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 3</span>
        <span class="cell-title">POST <code>$merge</code></span>
        <span class="cell-badge" id="badge-3">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Merges <code>Patient/${escapeHtml(SOURCE_ID)}</code> into
          <code>Patient/${escapeHtml(TARGET_ID)}</code>. The plan deactivates the source
          (<code>active:false</code> + <code>replaced-by</code>) instead of deleting it.
        </p>
        <div class="actions">
          <button class="btn btn-primary" id="btn-3">POST $merge</button>
          <span class="spinner" id="spin-3" hidden>Merging...</span>
        </div>
        <div id="out-3"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 4</span>
        <span class="cell-title">GET <code>Patient/${escapeHtml(TARGET_ID)}</code> (merge result)</span>
        <span class="cell-badge" id="badge-4">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          The survivor after the merge &mdash; data from both patients, with a
          <code>replaces</code> link to <code>Patient/${escapeHtml(SOURCE_ID)}</code>.
        </p>
        <div class="actions">
          <button class="btn btn-primary" id="btn-4">GET Patient/${escapeHtml(TARGET_ID)}</button>
          <span class="spinner" id="spin-4" hidden>Reading...</span>
        </div>
        <div id="out-4"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 5</span>
        <span class="cell-title">GET <code>Patient/${escapeHtml(SOURCE_ID)}</code> (<code>active: false</code>)</span>
        <span class="cell-badge" id="badge-5">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          The retired source &mdash; <code>active:false</code> with a
          <code>replaced-by</code> link to <code>Patient/${escapeHtml(TARGET_ID)}</code>. Still
          queryable for audit/history.
        </p>
        <div class="actions">
          <button class="btn btn-primary" id="btn-5">GET Patient/${escapeHtml(SOURCE_ID)}</button>
          <span class="spinner" id="spin-5" hidden>Reading...</span>
        </div>
        <div id="out-5"></div>
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
const TARGET_ID = ${JSON.stringify(TARGET_ID)};
const SOURCE_ID = ${JSON.stringify(SOURCE_ID)};

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

function renderOutput(hostId, payload, label) {
  const ok = payload && payload.ok;
  const status = payload && payload.status;
  $(hostId).innerHTML =
    '<div class="output">' +
      '<div class="output-bar">' +
        '<span class="' + (ok ? "status-ok" : "status-err") + '">' + (ok ? (label || "OK") : "HTTP " + (status ?? "error")) + '</span>' +
      '</div>' +
      '<pre class="output-body">' + escapeHtml(JSON.stringify(payload, null, 2)) + '</pre>' +
    '</div>';
}

// Generic "run a step" wrapper: toggles spinner + badge, renders the result.
async function runStep(n, run, runningText, okText) {
  $("btn-" + n).disabled = true;
  $("spin-" + n).hidden = false;
  setBadge("badge-" + n, "run", runningText);
  try {
    const data = await run();
    renderOutput("out-" + n, data, okText);
    setBadge("badge-" + n, data.ok ? "ok" : "err", data.ok ? "done" : "failed");
  } catch (e) {
    $("out-" + n).innerHTML = '<div class="error-msg">' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-" + n, "err", "failed");
  } finally {
    $("btn-" + n).disabled = false;
    $("spin-" + n).hidden = true;
  }
}

$("btn-1").addEventListener("click", () =>
  runStep(1, () => requestJson("/api/put-patient?which=target", { method: "POST", body: "{}" }), "posting", "created"));

$("btn-2").addEventListener("click", () =>
  runStep(2, () => requestJson("/api/put-patient?which=source", { method: "POST", body: "{}" }), "posting", "created"));

$("btn-3").addEventListener("click", () =>
  runStep(3, () => requestJson("/api/merge", { method: "POST", body: JSON.stringify({ sourceId: SOURCE_ID, targetId: TARGET_ID }) }), "merging", "merged"));

$("btn-4").addEventListener("click", () =>
  runStep(4, () => requestJson("/api/patient?id=" + encodeURIComponent(TARGET_ID)), "reading", "merge result"));

$("btn-5").addEventListener("click", () =>
  runStep(5, () => requestJson("/api/patient?id=" + encodeURIComponent(SOURCE_ID)), "reading", "active: false"));
`;
}
