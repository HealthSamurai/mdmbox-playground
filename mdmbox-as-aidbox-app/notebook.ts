/**
 * mdmbox-as-aidbox-app — a single-page "notebook" served by Bun.
 *
 * What it does, in three executable cells:
 *   1. Registers an Aidbox App that declares a `POST Patient/$match` operation.
 *      Aidbox routes that operation, over http-rpc, back to THIS server (/aidbox-rpc).
 *   2. Lets you run `$match` THROUGH Aidbox. The page calls Aidbox, Aidbox RPC-calls
 *      us, and we proxy/translate the call into the real mdmbox `$match`.
 *   3. Shows the resulting FHIR searchset Bundle (scores + match grades).
 *
 * Flow when a match runs:
 *   browser ──POST /fhir/Patient/$match──▶ Aidbox
 *   Aidbox  ──http-rpc {type:"operation"}─▶ this server (/aidbox-rpc)
 *   this    ──POST /api/fhir/Patient/$match──▶ mdmbox   (returns Bundle)
 *   this    ──Bundle──▶ Aidbox ──▶ browser
 */

const PORT = parseInt(process.env.PORT || "3300");

// Aidbox (admin client used to register the App, and the FHIR base the page hits).
const AIDBOX_URL = process.env.AIDBOX_URL || "http://localhost:8888";
const AIDBOX_AUTH = process.env.AIDBOX_AUTH || "Basic cm9vdDpyb290"; // root:root
// Host-visible Aidbox URL, for display in the page text only (the browser never
// calls Aidbox directly — all Aidbox traffic is proxied through this server).
const PUBLIC_AIDBOX_URL = process.env.PUBLIC_AIDBOX_URL || "http://localhost:8888";

// mdmbox — where the actual probabilistic matching lives.
const MDMBOX_URL = process.env.MDMBOX_URL || "http://localhost:3003";
const MDMBOX_AUTH = process.env.MDMBOX_AUTH; // optional; unset when dev-mode is on

// The MatchingModel installed in mdmbox to use for $match.
const MODEL_ID = process.env.MODEL_ID || "patient-mdl-default";

// Max candidate matches to request — same default the example-app uses
// (src/pages/match.tsx: MATCH_RESULT_LIMIT).
const MATCH_RESULT_LIMIT = 100;

// The URL Aidbox uses to reach THIS server over http-rpc.
// When Aidbox runs in Docker and this server runs on the host, use host.docker.internal.
const APP_BASE_URL = process.env.APP_BASE_URL || "http://host.docker.internal:3300";

const APP_ID = process.env.APP_ID || "mdmbox.match";
const APP_SECRET = process.env.APP_SECRET || "mdmbox-match-secret";

const DIR = import.meta.dir;

// ---------------------------------------------------------------------------
// The Aidbox App manifest. Declares one operation: POST Patient/$match,
// delivered to our /aidbox-rpc endpoint as an http-rpc "operation" envelope.
// ---------------------------------------------------------------------------
function appManifest() {
  return {
    resourceType: "App",
    id: APP_ID,
    apiVersion: 1,
    type: "app",
    endpoint: {
      type: "http-rpc",
      url: `${APP_BASE_URL}/aidbox-rpc`,
      secret: APP_SECRET,
    },
    operations: {
      // Instance-level $match: POST /fhir/Patient/{id}/$match — same endpoint
      // the example-app hits via mdmbox-sdk's matchById.
      "patient-match": {
        method: "POST",
        path: ["fhir", "Patient", { name: "id" }, "$match"],
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

// Aidbox -> us. Unwrap the operation envelope and forward to mdmbox $match.
async function handleAidboxRpc(req: Request): Promise<Response> {
  const envelope = await req.json().catch(() => ({}));

  // Aidbox http-rpc operation envelope:
  // { type:"operation", request:{ resource, params, route-params, headers }, operation:{ id }, box:{...} }
  const fhirParameters = envelope?.request?.resource;
  // The {id} declared in the operation path arrives as a route param.
  const id = envelope?.request?.["route-params"]?.id ?? envelope?.request?.routeParams?.id;

  if (!fhirParameters || fhirParameters.resourceType !== "Parameters") {
    return Response.json(
      operationOutcome("invalid", "Expected a FHIR Parameters resource in the operation request."),
      { status: 400 },
    );
  }
  if (!id) {
    return Response.json(
      operationOutcome("invalid", "Missing Patient id route param for instance-level $match."),
      { status: 400 },
    );
  }

  // Ensure a modelId is present — inject the configured default if the caller omitted it.
  const params = ensureModelId(fhirParameters, MODEL_ID);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (MDMBOX_AUTH) headers.authorization = MDMBOX_AUTH;

  // Instance-level mdmbox endpoint, exactly what the example-app's SDK hits.
  const res = await fetch(`${MDMBOX_URL}/api/fhir/Patient/${id}/$match`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  // Proxy mdmbox's response straight back; Aidbox forwards it to the client unchanged.
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") || "application/json" },
  });
}

/**
 * Build the FHIR Parameters body for an instance-level $match, EXACTLY as the
 * example-app does via mdmbox-sdk (`matchById` → `buildMatchParameters`):
 * only `modelId`, `threshold`, `count` are sent — no `resource` (the instance
 * is loaded server-side by id). See src/api/client.ts:matchPatientById and
 * mdmbox-sdk/src/client.ts:buildMatchParameters.
 */
function buildMatchParameters(opts: {
  modelId?: string;
  threshold?: number;
  count?: number;
  onlyCertainMatches?: boolean;
  onlySingleMatch?: boolean;
}) {
  const parameter: Array<Record<string, unknown>> = [];
  if (opts.modelId !== undefined) parameter.push({ name: "modelId", valueString: opts.modelId });
  if (opts.threshold !== undefined) parameter.push({ name: "threshold", valueDecimal: opts.threshold });
  if (opts.onlyCertainMatches !== undefined)
    parameter.push({ name: "onlyCertainMatches", valueBoolean: opts.onlyCertainMatches });
  if (opts.onlySingleMatch !== undefined)
    parameter.push({ name: "onlySingleMatch", valueBoolean: opts.onlySingleMatch });
  if (opts.count !== undefined) parameter.push({ name: "count", valueInteger: opts.count });
  return { resourceType: "Parameters", parameter };
}

// Page -> us -> Aidbox. Run instance-level $match THROUGH Aidbox, mirroring the
// example-app: POST /fhir/Patient/{id}/$match with a modelId/threshold/count body.
async function runMatchThroughAidbox(req: Request): Promise<Response> {
  const input = await req.json().catch(() => ({}));

  const resourceType = input.resourceType || "Patient";
  const id = String(input.id || "").trim();
  if (!id) {
    return Response.json(
      { ok: false, status: 400, error: "A Patient id is required for instance-level $match." },
      { status: 400 },
    );
  }

  const parameters = buildMatchParameters({
    modelId: input.modelId || MODEL_ID,
    threshold: input.threshold !== undefined && input.threshold !== "" ? Number(input.threshold) : undefined,
    count: input.count !== undefined && input.count !== "" ? Number(input.count) : MATCH_RESULT_LIMIT,
  });

  const url = `${AIDBOX_URL}/fhir/${resourceType}/${id}/$match`;
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

function ensureModelId(params: any, modelId: string) {
  const hasModel = (params.parameter || []).some((p: any) => p.name === "modelId");
  if (hasModel) return params;
  return {
    ...params,
    parameter: [{ name: "modelId", valueString: modelId }, ...(params.parameter || [])],
  };
}

function operationOutcome(code: string, diagnostics: string) {
  return {
    resourceType: "OperationOutcome",
    issue: [{ severity: "error", code, diagnostics }],
  };
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
        appBaseUrl: APP_BASE_URL,
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

    // Aidbox calls this over http-rpc when Patient/$match is invoked.
    if (pathname === "/aidbox-rpc" && req.method === "POST") {
      try {
        return await handleAidboxRpc(req);
      } catch (e) {
        return Response.json(operationOutcome("exception", String(e)), { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`📓 mdmbox-as-aidbox-app notebook → http://localhost:${server.port}`);
console.log(`   Aidbox:  ${AIDBOX_URL}`);
console.log(`   mdmbox:  ${MDMBOX_URL}`);
console.log(`   App RPC: ${APP_BASE_URL}/aidbox-rpc`);

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
          <code>POST Patient/$match</code> back to this Bun server over http-rpc.
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
          This calls <code>POST ${PUBLIC_AIDBOX_URL}/fhir/Patient/{id}/$match</code> —
          the same instance-level operation the example-app runs via mdmbox-sdk. Aidbox
          forwards it to this app, which proxies it to mdmbox and returns the searchset.
        </p>
        <div class="field-row">
          <div class="field">
            <label for="f-id">Patient id</label>
            <input id="f-id" placeholder="existing Patient id" />
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
          Instance-level <code>$match</code> loads the Patient by id server-side, so the
          body carries only <code>modelId</code>, <code>threshold</code>, <code>count</code>
          (no inline resource). Register the app in Cell 1 first and make sure the model is
          installed in mdmbox.
        </p>
        <div id="results-match" class="results"></div>
        <div id="out-match"></div>
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

// Mirror the SDK's buildMatchParameters so the preview matches what's sent.
function matchInput() {
  const count = $("f-count").value.trim();
  return {
    id: $("f-id").value.trim(),
    modelId: $("f-model").value.trim(),
    count: count === "" ? undefined : Number(count),
  };
}

function buildPreviewParameters(input) {
  const parameter = [];
  if (input.modelId) parameter.push({ name: "modelId", valueString: input.modelId });
  if (input.count !== undefined) parameter.push({ name: "count", valueInteger: input.count });
  return { resourceType: "Parameters", parameter };
}

function refreshPreview() {
  $("match-preview").textContent = JSON.stringify(buildPreviewParameters(matchInput()), null, 2);
}
["f-id", "f-model", "f-count"].forEach((id) => $(id).addEventListener("input", refreshPreview));
refreshPreview();

$("btn-match").addEventListener("click", async () => {
  const btn = $("btn-match");
  const input = matchInput();
  if (!input.id) {
    $("out-match").innerHTML = '<div class="error-msg">Enter an existing Patient id first.</div>';
    setBadge("badge-match", "err", "no id");
    return;
  }
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
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
