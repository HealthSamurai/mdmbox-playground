/**
 * mdmbox linkage notebook.
 *
 * Demonstrates the non-destructive `$link` / `$unlink` operations: two source
 * Patient records are grouped by a profiled `Linkage` resource that also carries
 * a golden (survivorship) view in its `contained`. Neither source is ever
 * modified — unlike `$merge`, nothing is rewritten or deleted. The link is then
 * reversed with `$unlink`, which removes the Linkage and leaves both sources
 * untouched.
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

// The two source records to link (they refer to the same person).
const A_ID = process.env.A_ID || "1";
const B_ID = process.env.B_ID || "2";
const A_REF = `Patient/${A_ID}`;
const B_REF = `Patient/${B_ID}`;

// The dedicated profile that marks a Linkage as mdmbox-managed. `$link` requires
// it (it defines the namespace for the "one active Linkage per reference" rule).
const LINKAGE_PROFILE =
  "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage";

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

// Patients and the Linkage are created/read through Aidbox's FHIR API. mdmbox()
// above is used only for the $link / $unlink calls (shared DB).
function aidboxFhir(path: string, opts: { method?: string; body?: unknown } = {}) {
  return jsonRequest(`${AIDBOX_URL}/fhir/${path.replace(/^\//, "")}`, {
    ...opts,
    auth: AIDBOX_AUTH,
  });
}

// ---------------------------------------------------------------------------
// Sample patients (two records referring to the same person)
// ---------------------------------------------------------------------------
function patientA(): JsonRecord {
  return {
    resourceType: "Patient",
    id: A_ID,
    active: true,
    identifier: [{ system: "https://example.org/mrn", value: "MRN-1000" }],
    name: [{ use: "official", given: ["Jane"], family: "Doe" }],
    birthDate: "1985-04-12",
    gender: "female",
    telecom: [{ system: "email", value: "jane.doe@example.org", use: "home" }],
    address: [{ city: "Boston", state: "MA", country: "US" }],
  };
}

function patientB(): JsonRecord {
  return {
    resourceType: "Patient",
    id: B_ID,
    active: true,
    identifier: [{ system: "https://example.org/mrn", value: "MRN-2000" }],
    name: [{ use: "official", given: ["Jane"], family: "Doe" }],
    birthDate: "1985-04-12",
    gender: "female",
    telecom: [{ system: "phone", value: "+1-555-0101", use: "mobile" }],
    address: [{ city: "Boston", state: "MA", country: "US" }],
  };
}

// The golden view: a survivorship record combining the best fields of both
// sources. It lives *inside* the Linkage (`contained`), not as a stored
// resource — it has a local `id` and carries no `meta.versionId/lastUpdated/
// security`. mdmbox never recalculates it; the client owns it.
const GOLDEN_ID = "golden";

function goldenPatient(): JsonRecord {
  return {
    resourceType: "Patient",
    id: GOLDEN_ID,
    active: true,
    // Survivorship: keep both source MRNs so the golden record traces back.
    identifier: [
      { system: "https://example.org/mrn", value: "MRN-1000" },
      { system: "https://example.org/mrn", value: "MRN-2000" },
    ],
    name: [{ use: "official", given: ["Jane"], family: "Doe" }],
    birthDate: "1985-04-12",
    gender: "female",
    // Both contact points survive (email from A, phone from B).
    telecom: [
      { system: "email", value: "jane.doe@example.org", use: "home" },
      { system: "phone", value: "+1-555-0101", use: "mobile" },
    ],
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

// ---------------------------------------------------------------------------
// Link: POST a profiled Linkage grouping the two records (no source modified)
// ---------------------------------------------------------------------------
function linkageResource(): JsonRecord {
  // The profile allows one contained golden view, named by the single `source`
  // item (`#golden`). The untouched source Patients become `alternate` members.
  return {
    resourceType: "Linkage",
    meta: { profile: [LINKAGE_PROFILE] },
    active: true,
    contained: [goldenPatient()],
    item: [
      { type: "source", resource: { reference: `#${GOLDEN_ID}` } },
      { type: "alternate", resource: { reference: A_REF } },
      { type: "alternate", resource: { reference: B_REF } },
    ],
  };
}

function buildLinkPlan() {
  // A POST entry carries a urn:uuid fullUrl so the audit Provenance can point
  // at the Linkage the transaction creates.
  const entry = {
    fullUrl: `urn:uuid:${crypto.randomUUID()}`,
    request: { method: "POST", url: "Linkage" },
    resource: linkageResource(),
  };
  return { entries: [entry] };
}

function buildLinkParameters(opts: { entries: JsonRecord[]; preview: boolean }) {
  // $link body: just { plan, preview } — the client owns the plan, there is no
  // source/target.
  return {
    resourceType: "Parameters",
    parameter: [
      { name: "plan", resource: { resourceType: "Bundle", type: "transaction", entry: opts.entries } },
      { name: "preview", valueBoolean: opts.preview },
    ],
  };
}

// Step 3: Page -> Bun -> mdmbox $link.
async function runLink() {
  const aRead = await aidboxFhir(`Patient/${encodeURIComponent(A_ID)}`);
  if (!aRead.ok) return { ok: false, status: aRead.status, error: `${A_REF} not found in Aidbox`, response: aRead.body };
  const bRead = await aidboxFhir(`Patient/${encodeURIComponent(B_ID)}`);
  if (!bRead.ok) return { ok: false, status: bRead.status, error: `${B_REF} not found in Aidbox`, response: bRead.body };

  const plan = buildLinkPlan();
  const body = buildLinkParameters({ entries: plan.entries, preview: false });

  const path = "/api/fhir/$link";
  const started = performance.now();
  const result = await mdmbox(path, { method: "POST", body });
  const elapsedMs = Math.round(performance.now() - started);

  return {
    ok: result.ok,
    status: result.status,
    via: `${MDMBOX_URL}${path}`,
    elapsedMs,
    request: { method: "POST", url: path, body },
    response: result.body,
  };
}

// Step 4: read the created Linkage back (search by member reference).
async function getLinkage() {
  const result = await aidboxFhir(`Linkage?item=${encodeURIComponent(A_REF)}`);
  const linkage = firstResource(result.body);
  return {
    ok: result.ok && !!linkage,
    status: result.status,
    request: { method: "GET", url: `Linkage?item=${A_REF}` },
    response: linkage ?? result.body,
  };
}

// ---------------------------------------------------------------------------
// Unlink: DELETE the Linkage (a profiled Linkage is fixed active=true, so it
// cannot be deactivated in place; its history is preserved via /_history).
// ---------------------------------------------------------------------------
async function findActiveLinkage(): Promise<JsonRecord | undefined> {
  const result = await aidboxFhir(`Linkage?item=${encodeURIComponent(A_REF)}`);
  const entries = (result.body as JsonRecord)?.entry ?? [];
  return entries
    .map((e: JsonRecord) => e.resource)
    .find(
      (l: JsonRecord) =>
        l?.active !== false && (l?.meta?.profile ?? []).includes(LINKAGE_PROFILE),
    );
}

async function findLinkTask(): Promise<JsonRecord | undefined> {
  const result = await aidboxFhir(`Task?code=link`);
  const tasks = ((result.body as JsonRecord)?.entry ?? []).map((e: JsonRecord) => e.resource);
  return tasks.find(
    (t: JsonRecord) =>
      (t?.businessStatus?.coding ?? []).some((c: JsonRecord) => c?.code === "linked") &&
      (t?.input ?? []).some((i: JsonRecord) => i?.valueReference?.reference === A_REF),
  );
}

async function runUnlink() {
  const linkage = await findActiveLinkage();
  if (!linkage) {
    return { ok: false, status: 404, error: "No active Linkage found — run Step 3 ($link) first." };
  }
  const task = await findLinkTask();
  if (!task) {
    return { ok: false, status: 404, error: "No active link Task found — run Step 3 ($link) first." };
  }

  const body = {
    resourceType: "Parameters",
    parameter: [
      { name: "task", valueReference: { reference: `Task/${task.id}` } },
      { name: "preview", valueBoolean: false },
      {
        name: "plan",
        resource: {
          resourceType: "Bundle",
          type: "transaction",
          entry: [{ request: { method: "DELETE", url: `Linkage/${linkage.id}` } }],
        },
      },
    ],
  };

  const path = "/api/fhir/$unlink";
  const started = performance.now();
  const result = await mdmbox(path, { method: "POST", body });
  const elapsedMs = Math.round(performance.now() - started);

  return {
    ok: result.ok,
    status: result.status,
    via: `${MDMBOX_URL}${path}`,
    elapsedMs,
    request: { method: "POST", url: path, body },
    response: result.body,
  };
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

function firstResource(searchset: unknown): JsonRecord | undefined {
  const entry = (searchset as JsonRecord)?.entry;
  return Array.isArray(entry) ? entry[0]?.resource : undefined;
}

function requiredId(resource: JsonRecord, label: string) {
  const id = String(resource?.id || "").trim();
  if (!id) throw new Error(`${label} must have id`);
  return id;
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
        aId: A_ID,
        bId: B_ID,
      });
    }

    // Step 1 & 2: POST (PUT/upsert) a patient into Aidbox.
    if (pathname === "/api/put-patient" && req.method === "POST") {
      try {
        const which = url.searchParams.get("which");
        const patient = which === "b" ? patientB() : patientA();
        const result = await putPatient(patient);
        return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    // Step 3: POST $link.
    if (pathname === "/api/link" && req.method === "POST") {
      try {
        const result = await runLink();
        return Response.json(result, { status: (result as any).ok ? 200 : (result as any).status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    // Step 4: GET the created Linkage.
    if (pathname === "/api/linkage" && req.method === "GET") {
      const result = await getLinkage();
      return Response.json(result, { status: result.ok ? 200 : result.status || 502 });
    }

    // Step 5: POST $unlink.
    if (pathname === "/api/unlink" && req.method === "POST") {
      try {
        const result = await runUnlink();
        return Response.json(result, { status: (result as any).ok ? 200 : (result as any).status || 502 });
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`mdmbox linkage example -> http://localhost:${server.port}`);
console.log(`Aidbox: ${AIDBOX_URL}  (create/read patients + Linkage)`);
console.log(`mdmbox: ${MDMBOX_URL}  ($link / $unlink)`);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
function renderPage(): string {
  const aJson = JSON.stringify(patientA(), null, 2);
  const bJson = JSON.stringify(patientB(), null, 2);
  const linkageJson = JSON.stringify(linkageResource(), null, 2);
  // The unlink plan is assembled at click time — the Task and Linkage ids are
  // resolved on the server, so this preview uses placeholders.
  const unlinkPlanJson = JSON.stringify(
    {
      resourceType: "Parameters",
      parameter: [
        { name: "task", valueReference: { reference: "Task/<link-task-id>" } },
        { name: "preview", valueBoolean: false },
        {
          name: "plan",
          resource: {
            resourceType: "Bundle",
            type: "transaction",
            entry: [{ request: { method: "DELETE", url: "Linkage/<id>" } }],
          },
        },
      ],
    },
    null,
    2,
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>mdmbox - link records non-destructively</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
  <link rel="stylesheet" href="/notebook.css" />
</head>
<body>
  <nav class="navbar">
    <a class="navbar-brand" href="/"><span class="dot"></span><span>mdmbox &times; $link</span></a>
    <span class="navbar-meta">link records, keep sources intact</span>
  </nav>

  <main class="page">
    <header class="page-header">
      <h1 class="page-title"><code>$link</code> &amp; <code>$unlink</code></h1>
      <p class="page-subtitle">
        Five steps: create two patient records, run mdmbox <code>$link</code> to group
        them under a profiled <code>Linkage</code>, read the link back, then reverse it
        with <code>$unlink</code>. Unlike <code>$merge</code>, <strong>neither source is
        ever modified</strong> &mdash; the link is a separate resource, and unlinking just
        removes it. <code>Patient/${escapeHtml(A_ID)}</code> and
        <code>Patient/${escapeHtml(B_ID)}</code> stay intact the whole time.
      </p>
    </header>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 1</span>
        <span class="cell-title">POST <code>Patient/${escapeHtml(A_ID)}</code> (record A)</span>
        <span class="cell-badge" id="badge-1">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">Creates the first source record in Aidbox.</p>
        <details class="disclosure">
          <summary>Request body</summary>
          <pre class="code">${escapeHtml(aJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-1">POST Patient/${escapeHtml(A_ID)}</button>
          <span class="spinner" id="spin-1" hidden>Posting...</span>
        </div>
        <div id="out-1"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 2</span>
        <span class="cell-title">POST <code>Patient/${escapeHtml(B_ID)}</code> (record B)</span>
        <span class="cell-badge" id="badge-2">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">Creates the second source record &mdash; same person, different system.</p>
        <details class="disclosure">
          <summary>Request body</summary>
          <pre class="code">${escapeHtml(bJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-2">POST Patient/${escapeHtml(B_ID)}</button>
          <span class="spinner" id="spin-2" hidden>Posting...</span>
        </div>
        <div id="out-2"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 3</span>
        <span class="cell-title">POST <code>$link</code></span>
        <span class="cell-badge" id="badge-3">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Groups <code>Patient/${escapeHtml(A_ID)}</code> and
          <code>Patient/${escapeHtml(B_ID)}</code> under one profiled
          <code>Linkage</code> that also carries a <strong>golden view</strong>
          in <code>contained</code> (referenced by the single <code>source</code>
          item as <code>#${escapeHtml(GOLDEN_ID)}</code>). The sources are not touched.
        </p>
        <details class="disclosure">
          <summary>Linkage in the plan (with contained golden view)</summary>
          <pre class="code">${escapeHtml(linkageJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-3">POST $link</button>
          <span class="spinner" id="spin-3" hidden>Linking...</span>
        </div>
        <div id="out-3"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 4</span>
        <span class="cell-title">GET <code>Linkage</code> (the link)</span>
        <span class="cell-badge" id="badge-4">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Reads the created <code>Linkage</code> back (search by member). Its
          <code>item[]</code> references both patients plus the contained golden
          view; the patients themselves are unchanged.
        </p>
        <div class="actions">
          <button class="btn btn-primary" id="btn-4">GET Linkage?item=${escapeHtml(A_REF)}</button>
          <span class="spinner" id="spin-4" hidden>Reading...</span>
        </div>
        <div id="out-4"></div>
      </div>
    </section>

    <section class="cell">
      <div class="cell-header">
        <span class="cell-num">Step 5</span>
        <span class="cell-title">POST <code>$unlink</code></span>
        <span class="cell-badge" id="badge-5">idle</span>
      </div>
      <div class="cell-body">
        <p class="muted">
          Reverses the link: the plan <code>DELETE</code>s the <code>Linkage</code>
          (a profiled Linkage is fixed <code>active:true</code>, so it can't be
          deactivated in place; its history stays in <code>/_history</code>). Both
          patients remain, and the references are free to link again.
        </p>
        <details class="disclosure">
          <summary>Unlink plan (ids resolved at run time)</summary>
          <pre class="code">${escapeHtml(unlinkPlanJson)}</pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-5">POST $unlink</button>
          <span class="spinner" id="spin-5" hidden>Unlinking...</span>
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
const A_REF = ${JSON.stringify(A_REF)};

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
  runStep(1, () => requestJson("/api/put-patient?which=a", { method: "POST", body: "{}" }), "posting", "created"));

$("btn-2").addEventListener("click", () =>
  runStep(2, () => requestJson("/api/put-patient?which=b", { method: "POST", body: "{}" }), "posting", "created"));

$("btn-3").addEventListener("click", () =>
  runStep(3, () => requestJson("/api/link", { method: "POST", body: "{}" }), "linking", "linked"));

$("btn-4").addEventListener("click", () =>
  runStep(4, () => requestJson("/api/linkage"), "reading", "the link"));

$("btn-5").addEventListener("click", () =>
  runStep(5, () => requestJson("/api/unlink", { method: "POST", body: "{}" }), "unlinking", "unlinked"));
`;
}
