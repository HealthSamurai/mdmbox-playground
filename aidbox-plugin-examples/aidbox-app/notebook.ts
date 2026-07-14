/**
 * mdmbox-as-aidbox-app — a single-page "notebook" served by Bun.
 *
 * What it does, in two executable cells:
 *   1. Registers an Aidbox App that declares a `POST Patient/$match` operation,
 *      with its http-rpc endpoint pointing at mdmbox's built-in aidbox-app-proxy.
 *   2. Lets you run `$match` THROUGH Aidbox and shows the FHIR searchset Bundle
 *      (scores + match grades).
 *
 * Flow when a match runs (Bun is NOT in this path — it only registers the App):
 *   browser ──POST /fhir/Patient/$match──▶ Aidbox
 *   Aidbox  ──http-rpc──▶ mdmbox /api/aidbox-app-proxy   (returns Bundle)
 *   Aidbox  ──Bundle──▶ browser
 */

const PORT = parseInt(process.env.PORT || "3300");

// Aidbox (admin client used to register the App, and the FHIR base the page hits).
const AIDBOX_URL = process.env.AIDBOX_URL || "http://localhost:8888";
const AIDBOX_AUTH = process.env.AIDBOX_AUTH || "Basic cm9vdDpyb290"; // root:root
// Host-visible Aidbox URL, for display in the page text only (the browser never
// calls Aidbox directly — all Aidbox traffic is proxied through this server).
const PUBLIC_AIDBOX_URL = process.env.PUBLIC_AIDBOX_URL || "http://localhost:8888";

// mdmbox — where the actual probabilistic matching lives (shown in the page;
// Aidbox reaches it via its App proxy, so the notebook never calls it directly).
const MDMBOX_URL = process.env.MDMBOX_URL || "http://localhost:3003";

// The MatchingModel installed in mdmbox to use for $match.
const MODEL_ID = process.env.MODEL_ID || "patient-example";

// Max candidate matches to request — same default the example-app uses
// (src/pages/match.tsx: MATCH_RESULT_LIMIT).
const MATCH_RESULT_LIMIT = 100;

// The endpoint Aidbox calls (over http-rpc) when the operation is invoked.
// This points at mdmbox's built-in Aidbox-app proxy, so Aidbox forwards $match
// straight to mdmbox without going through this server.
const APP_ENDPOINT_URL =
  process.env.APP_ENDPOINT_URL || "http://host.docker.internal:3003/api/aidbox-app-proxy";

const APP_ID = process.env.APP_ID || "mdmbox.match";
const APP_SECRET = process.env.APP_SECRET || "mdmbox-match-secret";

const DIR = import.meta.dir;

// ---------------------------------------------------------------------------
// The Aidbox App manifest. Declares two operations — $match and $merge —
// delivered over http-rpc to mdmbox's built-in aidbox-app-proxy endpoint.
// mdmbox's proxy maps each operation `path` to /api/<path…>, so:
//   ["fhir","Patient","$match"] -> /api/fhir/Patient/$match
//   ["$merge"]                  -> /api/$merge
// ---------------------------------------------------------------------------
function appManifest() {
  return {
    resourceType: "App",
    id: APP_ID,
    apiVersion: 1,
    type: "app",
    endpoint: {
      type: "http-rpc",
      url: APP_ENDPOINT_URL,
      secret: APP_SECRET,
    },
    operations: {
      // Type-level $match: POST /fhir/Patient/$match.
      "patient-match": {
        method: "POST",
        path: ["fhir", "Patient", "$match"],
      },
      // System-level $merge: POST /$merge (mdmbox route /api/$merge).
      "patient-merge": {
        method: "POST",
        path: ["$merge"],
      },
    },
  };
}

// PUT /App/{id} into Aidbox. Accepts an edited manifest from the page; falls
// back to the default manifest when none is provided.
async function registerApp(override?: any) {
  const manifest = override && typeof override === "object" ? override : appManifest();
  const appId = manifest.id || APP_ID;
  const res = await fetch(`${AIDBOX_URL}/App/${appId}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: AIDBOX_AUTH,
    },
    body: JSON.stringify(manifest),
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    manifest,
    body: safeJson(text),
  };
}

/**
 * Build the FHIR Parameters body for a type-level $match. The `resource` (the
 * Patient to match against) is sent inline alongside modelId/threshold/count.
 * See mdmbox-sdk/src/client.ts:buildMatchParameters (the type-level form).
 */
function buildMatchParameters(opts: {
  modelId?: string;
  resource?: Record<string, unknown>;
  threshold?: number;
  count?: number;
  onlyCertainMatches?: boolean;
  onlySingleMatch?: boolean;
}) {
  const parameter: Array<Record<string, unknown>> = [];
  if (opts.modelId !== undefined) parameter.push({ name: "modelId", valueString: opts.modelId });
  if (opts.resource !== undefined) parameter.push({ name: "resource", resource: opts.resource });
  if (opts.threshold !== undefined) parameter.push({ name: "threshold", valueDecimal: opts.threshold });
  if (opts.onlyCertainMatches !== undefined)
    parameter.push({ name: "onlyCertainMatches", valueBoolean: opts.onlyCertainMatches });
  if (opts.onlySingleMatch !== undefined)
    parameter.push({ name: "onlySingleMatch", valueBoolean: opts.onlySingleMatch });
  if (opts.count !== undefined) parameter.push({ name: "count", valueInteger: opts.count });
  return { resourceType: "Parameters", parameter };
}

// Page -> us -> Aidbox. Run type-level $match THROUGH Aidbox:
// POST /fhir/Patient/$match with an inline Patient resource.
async function runMatchThroughAidbox(req: Request): Promise<Response> {
  const input = await req.json().catch(() => ({}));

  const resourceType = input.resourceType || "Patient";
  const resource: Record<string, unknown> = {
    resourceType,
    name: [{ given: [input.given || ""].filter(Boolean), family: input.family || undefined }],
    birthDate: input.birthDate || undefined,
    gender: input.gender || undefined,
  };

  const parameters = buildMatchParameters({
    modelId: input.modelId || MODEL_ID,
    resource,
    threshold: input.threshold !== undefined && input.threshold !== "" ? Number(input.threshold) : undefined,
    count: input.count !== undefined && input.count !== "" ? Number(input.count) : MATCH_RESULT_LIMIT,
  });

  const url = `${AIDBOX_URL}/fhir/${resourceType}/$match`;
  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: AIDBOX_AUTH,
    },
    body: JSON.stringify(parameters),
  });
  const elapsedMs = Math.round(performance.now() - started);
  const text = await res.text();

  return Response.json({
    ok: res.ok,
    status: res.status,
    via: url,
    elapsedMs,
    request: parameters,
    response: safeJson(text),
  });
}

/**
 * Build the FHIR Parameters body for $merge, mirroring the example-app's SDK
 * (mdmbox-sdk buildMergeBody): source, target, preview, and a `plan` transaction
 * Bundle. See src/api/client.ts:unmerge/merge and mdmbox-sdk/src/client.ts.
 */
function buildMergeParameters(opts: {
  source: string;
  target: string;
  preview: boolean;
  plan: { entries: unknown[] };
}) {
  return {
    resourceType: "Parameters",
    parameter: [
      { name: "source", valueReference: { reference: opts.source } },
      { name: "target", valueReference: { reference: opts.target } },
      { name: "preview", valueBoolean: opts.preview },
      {
        name: "plan",
        resource: { resourceType: "Bundle", type: "transaction", entry: opts.plan.entries },
      },
    ],
  };
}

// Page -> us -> Aidbox. Run $merge THROUGH Aidbox: POST /$merge, which Aidbox
// routes (over http-rpc) to mdmbox's /api/$merge.
async function runMergeThroughAidbox(req: Request): Promise<Response> {
  const input = await req.json().catch(() => ({}));

  const source = String(input.source || "").trim();
  const target = String(input.target || "").trim();
  if (!source || !target) {
    return Response.json(
      { ok: false, status: 400, error: "Both source and target references are required for $merge." },
      { status: 400 },
    );
  }

  const parameters = buildMergeParameters({
    source,
    target,
    preview: input.preview !== false, // default to a safe preview
    plan: { entries: Array.isArray(input.entries) ? input.entries : [] },
  });

  const url = `${AIDBOX_URL}/$merge`;
  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: AIDBOX_AUTH,
    },
    body: JSON.stringify(parameters),
  });
  const elapsedMs = Math.round(performance.now() - started);
  const text = await res.text();

  return Response.json({
    ok: res.ok,
    status: res.status,
    via: url,
    elapsedMs,
    request: parameters,
    response: safeJson(text),
  });
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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

    if (pathname === "/api/config" && req.method === "GET") {
      return Response.json({
        aidboxUrl: AIDBOX_URL,
        mdmboxUrl: MDMBOX_URL,
        modelId: MODEL_ID,
        appId: APP_ID,
        appEndpointUrl: APP_ENDPOINT_URL,
        manifest: appManifest(),
      });
    }

    if (pathname === "/api/register-app" && req.method === "POST") {
      try {
        const override = await req.json().catch(() => undefined);
        return Response.json(await registerApp(override?.manifest));
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    if (pathname === "/api/match" && req.method === "POST") {
      try {
        return await runMatchThroughAidbox(req);
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    if (pathname === "/api/merge" && req.method === "POST") {
      try {
        return await runMergeThroughAidbox(req);
      } catch (e) {
        return Response.json({ ok: false, error: String(e) }, { status: 502 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`📓 mdmbox-as-aidbox-app notebook → http://localhost:${server.port}`);
console.log(`   Aidbox:  ${AIDBOX_URL}`);
console.log(`   mdmbox:  ${MDMBOX_URL}`);
console.log(`   App RPC: ${APP_ENDPOINT_URL}`);

// ---------------------------------------------------------------------------
// Page (server-rendered HTML; vanilla JS drives the cells — no build step).
// ---------------------------------------------------------------------------
function renderPage(): string {
  const manifest = JSON.stringify(appManifest(), null, 2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>mdmbox · $match as an Aidbox App</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
  <link rel="stylesheet" href="/notebook.css" />
</head>
<body>
  <nav class="navbar">
    <a class="navbar-brand" href="/"><span class="dot"></span><span>mdmbox &times; Aidbox</span></a>
    <span class="navbar-meta" id="nav-meta">model: ${MODEL_ID}</span>
  </nav>

  <main class="page">
    <header class="page-header">
      <h1 class="page-title">Provide <code>$match</code> as an Aidbox App</h1>
      <p class="page-subtitle">
        Register an Aidbox App that exposes <code>POST Patient/$match</code>, backed by mdmbox's
        probabilistic matching over http-rpc. Then run a match <strong>through Aidbox</strong> and
        watch the searchset come back.
      </p>
    </header>

    <!-- Cell 1: register the app -->
    <section class="cell" id="cell-register">
      <div class="cell-header">
        <span class="cell-num">Cell 1</span>
        <span class="cell-title">Register the Aidbox App</span>
        <span class="cell-badge" id="badge-register">idle</span>
      </div>
      <div class="cell-body">
        <p>
          <code>PUT /App/${APP_ID}</code> installs this manifest in Aidbox. The
          <code>operations.patient-match</code> entry tells Aidbox to route
          <code>POST Patient/$match</code> over http-rpc to mdmbox's
          <code>aidbox-app-proxy</code> endpoint.
        </p>
        <details class="disclosure" open>
          <summary>App manifest (editable)</summary>
          <textarea class="code-editor" id="manifest-editor" spellcheck="false">${escapeHtml(manifest)}</textarea>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-register">Register app in Aidbox</button>
          <button class="btn btn-ghost" id="btn-reset-manifest">Reset</button>
          <span class="spinner" id="spin-register" hidden>Registering…</span>
        </div>
        <div id="out-register"></div>
      </div>
    </section>

    <!-- Cell 2: run $match through Aidbox -->
    <section class="cell" id="cell-match">
      <div class="cell-header">
        <span class="cell-num">Cell 2</span>
        <span class="cell-title">Run <code>$match</code> through Aidbox</span>
        <span class="cell-badge" id="badge-match">idle</span>
      </div>
      <div class="cell-body">
        <p>
          This calls <code>POST ${PUBLIC_AIDBOX_URL}/fhir/Patient/$match</code>. Aidbox
          routes the operation, over http-rpc, to mdmbox's <code>aidbox-app-proxy</code>,
          which runs the match and returns the searchset.
        </p>
        <div class="field-row">
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
            <label for="f-model">Model id</label>
            <input id="f-model" value="${MODEL_ID}" />
          </div>
          <div class="field">
            <label for="f-count">Count</label>
            <input id="f-count" value="100" inputmode="numeric" />
          </div>
        </div>
        <details class="disclosure">
          <summary>Parameters body sent to $match (preview)</summary>
          <pre class="code" id="match-preview"></pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-match">Run $match via Aidbox</button>
          <span class="spinner" id="spin-match" hidden>Matching…</span>
        </div>
        <p class="hint">
          Type-level <code>$match</code> carries the Patient inline as the
          <code>resource</code> parameter, alongside <code>modelId</code> and
          <code>count</code>. Register the app in Cell 1 first and make sure the model is
          installed in mdmbox.
        </p>
        <div id="results-match" class="results"></div>
        <div id="out-match"></div>
      </div>
    </section>

    <!-- Cell 3: run $merge through Aidbox -->
    <section class="cell" id="cell-merge">
      <div class="cell-header">
        <span class="cell-num">Cell 3</span>
        <span class="cell-title">Run <code>$merge</code> through Aidbox</span>
        <span class="cell-badge" id="badge-merge">idle</span>
      </div>
      <div class="cell-body">
        <p>
          This calls <code>POST ${PUBLIC_AIDBOX_URL}/$merge</code>. Aidbox routes the
          operation, over http-rpc, to mdmbox's <code>/api/$merge</code>, which executes
          the client-provided merge plan (a FHIR transaction Bundle) and records Task /
          Provenance for audit and unmerge.
        </p>
        <div class="field-row">
          <div class="field">
            <label for="f-source">Source reference</label>
            <input id="f-source" placeholder="Patient/src-id" />
          </div>
          <div class="field">
            <label for="f-target">Target reference</label>
            <input id="f-target" placeholder="Patient/dst-id" />
          </div>
          <div class="field">
            <label for="f-preview">Preview</label>
            <select id="f-preview">
              <option value="true">true (dry-run)</option>
              <option value="false">false (apply)</option>
            </select>
          </div>
        </div>
        <details class="disclosure">
          <summary>Merge plan — transaction Bundle entries (editable JSON array)</summary>
          <textarea class="code-editor" id="merge-plan" spellcheck="false">[]</textarea>
        </details>
        <details class="disclosure">
          <summary>Parameters body sent to $merge (preview)</summary>
          <pre class="code" id="merge-preview"></pre>
        </details>
        <div class="actions">
          <button class="btn btn-primary" id="btn-merge">Run $merge via Aidbox</button>
          <span class="spinner" id="spin-merge" hidden>Merging…</span>
        </div>
        <p class="hint">
          The <code>plan</code> is a transaction Bundle of <code>PUT</code>/<code>DELETE</code>
          entries that fold the source into the target. Keep <code>preview: true</code> to
          validate without writing. Register the app in Cell 1 first.
        </p>
        <div id="out-merge"></div>
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

function setBadge(id, state, text) {
  const el = $(id);
  el.className = "cell-badge " + (state || "");
  el.textContent = text;
}

function renderOutput(hostId, payload) {
  const ok = payload && payload.ok;
  const status = payload && payload.status;
  const body = payload && (payload.response !== undefined ? payload.response : payload.body !== undefined ? payload.body : payload);
  const meta = payload && payload.via ? payload.via + (payload.elapsedMs != null ? "  ·  " + payload.elapsedMs + "ms" : "") : "";
  $(hostId).innerHTML =
    '<div class="output">' +
      '<div class="output-bar">' +
        '<span class="' + (ok ? "status-ok" : "status-err") + '">' + (ok ? "200 OK" : "HTTP " + (status ?? "error")) + '</span>' +
        (meta ? '<span>' + escapeHtml(meta) + '</span>' : '') +
      '</div>' +
      '<pre class="output-body">' + escapeHtml(JSON.stringify(body, null, 2)) + '</pre>' +
    '</div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Cell 1 — register (manifest is editable in the textarea)
const DEFAULT_MANIFEST = $("manifest-editor").value;

$("btn-reset-manifest").addEventListener("click", () => {
  $("manifest-editor").value = DEFAULT_MANIFEST;
  $("out-register").innerHTML = "";
  setBadge("badge-register", "", "idle");
});

$("btn-register").addEventListener("click", async () => {
  const btn = $("btn-register");

  // Parse + validate the edited manifest before sending.
  let manifest;
  try {
    manifest = JSON.parse($("manifest-editor").value);
  } catch (e) {
    $("out-register").innerHTML = '<div class="error-msg">Invalid JSON: ' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-register", "err", "invalid json");
    return;
  }

  btn.disabled = true;
  $("spin-register").hidden = false;
  setBadge("badge-register", "run", "registering");
  try {
    const r = await fetch("/api/register-app", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest }),
    });
    const data = await r.json();
    renderOutput("out-register", data);
    setBadge("badge-register", data.ok ? "ok" : "err", data.ok ? "registered" : "failed");
  } catch (e) {
    $("out-register").innerHTML = '<div class="error-msg">' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-register", "err", "failed");
  } finally {
    btn.disabled = false;
    $("spin-register").hidden = true;
  }
});

// Cell 2 — match
function gradeOf(entry) {
  const ext = (entry.resource && entry.resource.meta && entry.resource.meta.extension) || (entry.search && entry.search.extension) || [];
  const g = ext.find((e) => (e.url || "").includes("match-grade"));
  return g ? g.valueCode : "";
}

function renderResults(bundle) {
  const host = $("results-match");
  if (!bundle || bundle.resourceType !== "Bundle" || !Array.isArray(bundle.entry) || bundle.entry.length === 0) {
    host.innerHTML = '<p class="muted">No matches returned.</p>';
    return;
  }
  const rows = bundle.entry.map((e) => {
    const r = e.resource || {};
    const name = (r.name && r.name[0]) || {};
    const given = (name.given || []).join(" ");
    const score = e.search ? e.search.score : "";
    const grade = gradeOf(e);
    return '<tr>' +
      '<td class="num">' + (score != null ? Number(score).toFixed(2) : "—") + '</td>' +
      '<td>' + (grade ? '<span class="grade ' + grade + '">' + grade + '</span>' : "—") + '</td>' +
      '<td>' + escapeHtml((given + " " + (name.family || "")).trim() || "—") + '</td>' +
      '<td>' + escapeHtml(r.birthDate || "—") + '</td>' +
      '<td><code>Patient/' + escapeHtml(r.id || "—") + '</code></td>' +
    '</tr>';
  }).join("");
  host.innerHTML =
    '<table class="results-table"><thead><tr>' +
      '<th class="num">Score</th><th>Grade</th><th>Name</th><th>Birthdate</th><th>Reference</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

// Mirror the server's buildMatchParameters so the preview matches what's sent.
function matchInput() {
  const count = $("f-count").value.trim();
  return {
    given: $("f-given").value.trim(),
    family: $("f-family").value.trim(),
    birthDate: $("f-birthDate").value.trim(),
    modelId: $("f-model").value.trim(),
    count: count === "" ? undefined : Number(count),
  };
}

function buildPreviewParameters(input) {
  const parameter = [];
  if (input.modelId) parameter.push({ name: "modelId", valueString: input.modelId });
  parameter.push({
    name: "resource",
    resource: {
      resourceType: "Patient",
      name: [{ given: input.given ? [input.given] : [], family: input.family || undefined }],
      birthDate: input.birthDate || undefined,
    },
  });
  if (input.count !== undefined) parameter.push({ name: "count", valueInteger: input.count });
  return { resourceType: "Parameters", parameter };
}

function refreshPreview() {
  $("match-preview").textContent = JSON.stringify(buildPreviewParameters(matchInput()), null, 2);
}
["f-given", "f-family", "f-birthDate", "f-model", "f-count"].forEach((id) => $(id).addEventListener("input", refreshPreview));
refreshPreview();

$("btn-match").addEventListener("click", async () => {
  const btn = $("btn-match");
  const input = matchInput();
  btn.disabled = true;
  $("spin-match").hidden = false;
  setBadge("badge-match", "run", "matching");
  $("results-match").innerHTML = "";
  try {
    const r = await fetch("/api/match", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await r.json();
    renderResults(data.response);
    renderOutput("out-match", data);
    setBadge("badge-match", data.ok ? "ok" : "err", data.ok ? "done" : "failed");
  } catch (e) {
    $("out-match").innerHTML = '<div class="error-msg">' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-match", "err", "failed");
  } finally {
    btn.disabled = false;
    $("spin-match").hidden = true;
  }
});

// Cell 3 — merge. Mirror the server's buildMergeParameters for the live preview.
function mergeInput() {
  let entries = [];
  let planError = null;
  try {
    const parsed = JSON.parse($("merge-plan").value || "[]");
    if (!Array.isArray(parsed)) throw new Error("plan must be a JSON array of Bundle entries");
    entries = parsed;
  } catch (e) {
    planError = String(e);
  }
  return {
    source: $("f-source").value.trim(),
    target: $("f-target").value.trim(),
    preview: $("f-preview").value === "true",
    entries,
    planError,
  };
}

function buildMergePreview(input) {
  return {
    resourceType: "Parameters",
    parameter: [
      { name: "source", valueReference: { reference: input.source } },
      { name: "target", valueReference: { reference: input.target } },
      { name: "preview", valueBoolean: input.preview },
      { name: "plan", resource: { resourceType: "Bundle", type: "transaction", entry: input.entries } },
    ],
  };
}

function refreshMergePreview() {
  const input = mergeInput();
  $("merge-preview").textContent = input.planError
    ? "// invalid plan JSON: " + input.planError
    : JSON.stringify(buildMergePreview(input), null, 2);
}
["f-source", "f-target", "f-preview", "merge-plan"].forEach((id) => $(id).addEventListener("input", refreshMergePreview));
refreshMergePreview();

$("btn-merge").addEventListener("click", async () => {
  const btn = $("btn-merge");
  const input = mergeInput();
  if (!input.source || !input.target) {
    $("out-merge").innerHTML = '<div class="error-msg">Enter both source and target references.</div>';
    setBadge("badge-merge", "err", "missing refs");
    return;
  }
  if (input.planError) {
    $("out-merge").innerHTML = '<div class="error-msg">Invalid plan JSON: ' + escapeHtml(input.planError) + '</div>';
    setBadge("badge-merge", "err", "invalid plan");
    return;
  }
  btn.disabled = true;
  $("spin-merge").hidden = false;
  setBadge("badge-merge", "run", input.preview ? "previewing" : "merging");
  try {
    const r = await fetch("/api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: input.source,
        target: input.target,
        preview: input.preview,
        entries: input.entries,
      }),
    });
    const data = await r.json();
    renderOutput("out-merge", data);
    setBadge("badge-merge", data.ok ? "ok" : "err", data.ok ? (input.preview ? "preview ok" : "merged") : "failed");
  } catch (e) {
    $("out-merge").innerHTML = '<div class="error-msg">' + escapeHtml(String(e)) + '</div>';
    setBadge("badge-merge", "err", "failed");
  } finally {
    btn.disabled = false;
    $("spin-merge").hidden = true;
  }
});
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
