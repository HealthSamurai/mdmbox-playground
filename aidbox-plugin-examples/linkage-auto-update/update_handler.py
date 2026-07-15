#!/usr/bin/env python3
"""linkage-auto-update handler app.

A long-running webhook server. Aidbox calls it (via AidboxTopicDestination)
whenever a Patient is updated. The server finds the profiled Linkage the updated
Patient belongs to, rebuilds the golden (survivorship) view in the Linkage's
`contained` from the current source records, and PUTs the Linkage back.

  Aidbox --webhook (Patient/update)--> this app --PUT Linkage--> Aidbox

Why PUT to Aidbox instead of mdmbox $link: the mdmbox $link plan forbids
PUT/DELETE and its PATCH accepts only add/insert -- so it cannot *replace* the
contained golden view. The golden view is client-owned, so the handler updates
the Linkage directly through Aidbox's FHIR API.

Endpoints:
  GET  /health                    -- liveness probe
  GET  /api/events[?patientId=]   -- inspect recorded flows (debugging aid)
  POST /api/clear-events          -- drop the in-memory flow log
  POST /webhooks/patient-updated  -- the webhook Aidbox calls on Patient/update
                                     (requires Authorization: Bearer <secret>)

Only the Python standard library is used. Run it directly:

  python update_handler.py
"""

import copy
import datetime
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def trim_slash(s: str) -> str:
    return s.rstrip("/")


PORT = int(os.environ.get("WEBHOOK_PORT", "3302"))

AIDBOX_URL = trim_slash(os.environ.get("AIDBOX_URL", "http://localhost:8888"))
AIDBOX_AUTH = os.environ.get("AIDBOX_AUTH", "Basic cm9vdDpyb290")  # root:root

# The profile that marks a Linkage as mdmbox-managed.
LINKAGE_PROFILE = "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage"
# The contained golden view's local id inside the Linkage.
GOLDEN_ID = os.environ.get("GOLDEN_ID", "golden")

WEBHOOK_PATH = "/webhooks/patient-updated"
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "aidbox-to-handler-secret")

# Optimistic-concurrency retries when the Linkage is changed by a concurrent
# update between our read and our write (HTTP 412 Precondition Failed).
MAX_PUT_ATTEMPTS = int(os.environ.get("MAX_PUT_ATTEMPTS", "5"))

# In-memory flow log. Guarded by _flows_lock since the server is threaded.
_flows = []                 # newest first
_flow_by_patient_id = {}
_flows_lock = threading.Lock()


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def safe_json(text):
    if not text:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return text


def json_request(url, method="GET", auth=None, body=None, extra_headers=None):
    headers = {"accept": "application/json"}
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if auth:
        headers["authorization"] = auth
    if extra_headers:
        headers.update(extra_headers)

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            text = res.read().decode("utf-8", "replace")
            status = res.status
            return {"ok": 200 <= status < 300, "status": status, "url": url,
                    "body": safe_json(text), "text": text}
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        return {"ok": False, "status": e.code, "url": url,
                "body": safe_json(text), "text": text}
    except urllib.error.URLError as e:
        return {"ok": False, "status": 0, "url": url,
                "body": {"error": "Request failed: " + str(e.reason)}, "text": ""}


def aidbox_fhir(path, method="GET", body=None, extra_headers=None):
    return json_request(AIDBOX_URL + "/fhir/" + path.lstrip("/"),
                        method=method, auth=AIDBOX_AUTH, body=body,
                        extra_headers=extra_headers)


def assert_ok(result, label):
    if result["ok"]:
        return result
    raise RuntimeError("{} failed: HTTP {} {}".format(
        label, result["status"], stringify_short(result["body"])))


# ---------------------------------------------------------------------------
# Linkage lookup + golden rebuild
# ---------------------------------------------------------------------------
def find_active_linkage(patient_ref):
    """The single active profiled Linkage the patient reference belongs to."""
    result = aidbox_fhir("Linkage?item=" + urllib.parse.quote(patient_ref, safe=""))
    if not result["ok"]:
        return None
    body = result["body"] if isinstance(result["body"], dict) else {}
    for e in body.get("entry", []):
        linkage = e.get("resource") or {}
        profiles = (linkage.get("meta") or {}).get("profile") or []
        if linkage.get("active") is not False and LINKAGE_PROFILE in profiles:
            return linkage
    return None


def source_patient_refs(linkage):
    """The `alternate` member references (the real source Patients). The single
    `source` item points at the contained golden (#...), which we skip."""
    refs = []
    for item in (linkage.get("item") or []):
        ref = (item.get("resource") or {}).get("reference") or ""
        if item.get("type") == "alternate" and ref and not ref.startswith("#"):
            refs.append(ref)
    return refs


def rebuild_golden(source_patients):
    """Union the source records into a golden survivorship view. Scalars: first
    non-empty wins; arrays: unioned & de-duplicated. Local id + no meta so it
    stays a client-owned contained resource."""
    golden = {"resourceType": "Patient", "id": GOLDEN_ID}
    for patient in source_patients:
        for key, value in patient.items():
            if key in ("resourceType", "id", "meta"):
                continue
            golden[key] = merge_value(value, golden.get(key))
    return compact(golden)


def merge_value(incoming, current):
    if isinstance(incoming, list) or isinstance(current, list):
        return union_unique(
            current if isinstance(current, list) else [],
            incoming if isinstance(incoming, list) else [],
        )
    if is_plain_object(incoming) and is_plain_object(current):
        result = deep_clone(current)
        for key, value in incoming.items():
            result[key] = merge_value(value, result.get(key))
        return compact(result)
    # Scalars: keep the first non-empty value already collected.
    if is_filled(current):
        return current
    return deep_clone(incoming)


def union_unique(current_items, incoming_items):
    seen = set()
    result = []
    for item in list(current_items) + list(incoming_items):
        if not is_filled(item):
            continue
        key = stable_stringify(item)
        if key in seen:
            continue
        seen.add(key)
        result.append(deep_clone(item))
    return result


def set_contained_golden(linkage, golden):
    """Return a copy of the Linkage with its contained golden view replaced."""
    result = deep_clone(linkage)
    result["contained"] = [golden]
    return result


# ---------------------------------------------------------------------------
# Flow
# ---------------------------------------------------------------------------
def process_patient_updated(notification, patient_ref):
    patient_id = required_id(patient_ref, "notification patient")
    patient_reference = "Patient/" + patient_id

    with _flows_lock:
        flow = new_flow(patient_id, notification)
    flow["notification"] = notification
    add_step(flow, "webhook received", True, {"patientId": patient_id})

    try:
        flow["status"] = "locating"
        linkage = find_active_linkage(patient_reference)
        if not linkage:
            flow["status"] = "no-linkage"
            add_step(flow, "no active Linkage for this patient, nothing to update", True)
            return finish_flow(flow)
        flow["linkage"] = linkage
        add_step(flow, "active Linkage found", True, {
            "id": linkage.get("id"),
            "versionId": (linkage.get("meta") or {}).get("versionId"),
        })

        # Read sources, rebuild the golden view, and PUT the Linkage back with
        # If-Match. If another update raced us and bumped the Linkage version
        # (HTTP 412), re-read the Linkage and retry: the sources are read fresh
        # each attempt, so the final golden reflects every concurrent change.
        linkage_id = linkage["id"]
        put = None
        for attempt in range(1, MAX_PUT_ATTEMPTS + 1):
            flow["status"] = "reading-sources"
            refs = source_patient_refs(linkage)
            sources = []
            for ref in refs:
                pid = ref.split("Patient/", 1)[-1]
                patient = assert_ok(
                    aidbox_fhir("Patient/" + urllib.parse.quote(pid, safe="")),
                    "Read {}".format(ref))["body"]
                sources.append(patient)
            flow["sources"] = sources
            add_step(flow, "source patients read", True, {"count": len(sources), "refs": refs})

            flow["status"] = "rebuilding"
            golden = rebuild_golden(sources)
            updated = set_contained_golden(linkage, golden)
            flow["golden"] = golden
            add_step(flow, "golden view rebuilt", True, {
                "fields": sorted(k for k in golden if k not in ("resourceType", "id")),
            })

            flow["status"] = "writing"
            # Optimistic concurrency: only overwrite the Linkage version we read.
            version_id = (linkage.get("meta") or {}).get("versionId")
            extra = {"If-Match": 'W/"{}"'.format(version_id)} if version_id else None
            put = aidbox_fhir("Linkage/" + urllib.parse.quote(linkage_id, safe=""),
                              method="PUT", body=updated, extra_headers=extra)
            if put["ok"]:
                break
            if put["status"] == 412 and attempt < MAX_PUT_ATTEMPTS:
                add_step(flow, "Linkage changed underneath us (412), retrying", True,
                         {"attempt": attempt, "staleVersionId": version_id})
                # Re-read the current Linkage so the next attempt uses its version.
                reread = assert_ok(
                    aidbox_fhir("Linkage/" + urllib.parse.quote(linkage_id, safe="")),
                    "Re-read Linkage/{}".format(linkage_id))["body"]
                linkage = reread
                continue
            assert_ok(put, "PUT Linkage/{}".format(linkage_id))

        flow["updatedLinkage"] = put["body"]
        flow["status"] = "updated"
        add_step(flow, "Linkage updated with rebuilt golden view", True, {
            "id": linkage_id,
            "fromVersionId": (linkage.get("meta") or {}).get("versionId"),
            "toVersionId": (put["body"].get("meta") or {}).get("versionId")
            if isinstance(put["body"], dict) else None,
        })
        return finish_flow(flow)
    except Exception as e:  # noqa: BLE001 -- record any failure into the flow log
        flow["status"] = "error"
        flow["error"] = str(e)
        add_step(flow, "flow failed", False, flow["error"])
        return finish_flow(flow)


# ---------------------------------------------------------------------------
# Webhook notification parsing
# ---------------------------------------------------------------------------
def extract_patient_refs(payload):
    """Collect Patient ids from the webhook payload -- from Patient resources and
    from Patient/<id> references, dedup-preserving order."""
    refs = []
    seen = set()

    def add(pid):
        if pid and pid not in seen:
            seen.add(pid)
            refs.append({"resourceType": "Patient", "id": pid})

    def visit(node, depth):
        if depth > 8 or node is None or not isinstance(node, (dict, list)):
            return
        if isinstance(node, list):
            for item in node:
                visit(item, depth + 1)
            return
        if node.get("resourceType") == "Patient":
            add(node.get("id") or extract_reference_id(node.get("reference")))
        ref = node.get("reference")
        if isinstance(ref, str) and ref.startswith("Patient/"):
            add(extract_reference_id(ref))
        for value in node.values():
            visit(value, depth + 1)

    visit(payload, 0)
    return refs


# ---------------------------------------------------------------------------
# Flow log
# ---------------------------------------------------------------------------
def new_flow(patient_id, notification):
    flow = {
        "id": str(uuid.uuid4()),
        "patientId": patient_id,
        "status": "received",
        "startedAt": now(),
        "updatedAt": now(),
        "notification": notification,
        "steps": [],
    }
    _flows.insert(0, flow)
    _flow_by_patient_id[patient_id] = flow
    if len(_flows) > 50:
        del _flows[50:]
    return flow


def add_step(flow, label, ok, details=None):
    flow["steps"].append({"at": now(), "label": label, "ok": ok, "details": details})
    flow["updatedAt"] = now()


def finish_flow(flow):
    flow["updatedAt"] = now()
    return flow


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def required_id(resource, label):
    pid = str((resource or {}).get("id") or "").strip()
    if not pid:
        raise ValueError(label + " must have id")
    return pid


def extract_reference_id(reference):
    if not isinstance(reference, str):
        return None
    if reference.startswith("Patient/"):
        rest = reference.split("Patient/", 1)[1]
        return rest.split("/", 1)[0] or None
    return None


def is_plain_object(value):
    return isinstance(value, dict)


def is_filled(value):
    if value is None:
        return False
    if isinstance(value, bool):
        return True
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, (list, tuple)):
        return len(value) > 0
    if isinstance(value, dict):
        return len(value) > 0
    return True


def compact(value):
    if isinstance(value, list):
        return [c for c in (compact(v) for v in value) if is_filled(c)]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            compacted = compact(item)
            if is_filled(compacted):
                result[key] = compacted
        return result
    return value


def deep_clone(value):
    return copy.deepcopy(value)


def stable_stringify(value):
    if isinstance(value, list):
        return "[" + ",".join(stable_stringify(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key) + ":" + stable_stringify(value[key])
            for key in sorted(value.keys())
        ) + "}"
    return json.dumps(value)


def stringify_short(value):
    s = value if isinstance(value, str) else json.dumps(value)
    return s[:500] + "..." if len(s) > 500 else s


# ---------------------------------------------------------------------------
# HTTP server (webhook receiver)
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("content-length") or 0)
        return self.rfile.read(length).decode("utf-8", "replace") if length else ""

    def log_message(self, fmt, *args):
        print("[handler] " + (fmt % args))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            self._send_json({"ok": True})
            return
        if parsed.path == "/api/events":
            qs = urllib.parse.parse_qs(parsed.query)
            patient_id = (qs.get("patientId") or [None])[0]
            with _flows_lock:
                if patient_id:
                    data = [f for f in _flows if f["patientId"] == patient_id]
                else:
                    data = _flows[:20]
                data = deep_clone(data)
            self._send_json({"ok": True, "events": data})
            return
        self._send_json({"ok": False, "error": "Not found"}, status=404)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/clear-events":
            with _flows_lock:
                _flows.clear()
                _flow_by_patient_id.clear()
            self._send_json({"ok": True})
            return

        if parsed.path == WEBHOOK_PATH:
            auth = self.headers.get("authorization") or ""
            if auth != "Bearer " + WEBHOOK_SECRET:
                self._send_json({"ok": False, "error": "Unauthorized webhook"}, status=401)
                return

            payload = safe_json(self._read_body())
            refs = extract_patient_refs(payload)
            if not refs:
                self._send_json({
                    "ok": True, "ignored": True,
                    "reason": "No Patient resource or reference in webhook payload",
                })
                return

            processed = [process_patient_updated(payload, ref) for ref in refs]
            self._send_json({
                "ok": all(f["status"] != "error" for f in processed),
                "processed": [{"id": f["id"], "patientId": f["patientId"], "status": f["status"]}
                              for f in processed],
            })
            return

        self._send_json({"ok": False, "error": "Not found"}, status=404)


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("linkage-auto-update handler app -> http://localhost:{}{}".format(PORT, WEBHOOK_PATH))
    print("Aidbox:  {}".format(AIDBOX_URL))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
