#!/usr/bin/env python3
"""auto-merge handler app.

A long-running webhook server. Aidbox calls it (via AidboxTopicDestination)
whenever a Patient is created. The server then runs $match + $merge against
MDMbox automatically to search for duplicates and merge them.

  Aidbox --webhook--> this app --$match/$merge--> MDMbox

Endpoints:
  GET  /health                    -- liveness probe
  GET  /api/events[?patientId=]   -- inspect recorded flows (debugging aid)
  POST /api/clear-events          -- drop the in-memory flow log
  POST /webhooks/patient-created  -- the webhook Aidbox calls on Patient/create
                                     (requires Authorization: Bearer <secret>)

Only the Python standard library is used. Run it directly:

  python auto_merge_handler_app.py
"""

import base64
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


def basic_auth(client_id, secret):
    raw = "{}:{}".format(client_id, secret).encode("utf-8")
    return "Basic " + base64.b64encode(raw).decode("ascii")


PORT = int(os.environ.get("WEBHOOK_PORT", "3301"))

AIDBOX_URL = trim_slash(os.environ.get("AIDBOX_URL", "http://localhost:8888"))
AIDBOX_AUTH = os.environ.get("AIDBOX_AUTH", "Basic cm9vdDpyb290")  # root:root

MDMBOX_URL = trim_slash(os.environ.get("MDMBOX_URL", "http://localhost:3003"))
MDMBOX_CLIENT_ID = os.environ.get("MDMBOX_CLIENT_ID", "mdmbox-automerge-client")
MDMBOX_CLIENT_SECRET = os.environ.get("MDMBOX_CLIENT_SECRET", "mdmbox-automerge-secret")
MDMBOX_APP_AUTH = os.environ.get(
    "MDMBOX_APP_AUTH", basic_auth(MDMBOX_CLIENT_ID, MDMBOX_CLIENT_SECRET))

MODEL_ID = os.environ.get("MODEL_ID", "patient-example")
MATCH_RESULT_LIMIT = int(os.environ.get("MATCH_RESULT_LIMIT", "1"))

WEBHOOK_PATH = "/webhooks/patient-created"
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "aidbox-to-bun-secret")

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


def json_request(url, method="GET", auth=None, body=None, headers=None):
    hdrs = {"accept": "application/json"}
    if headers:
        hdrs.update(headers)
    data = None
    if body is not None:
        hdrs["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if auth:
        hdrs["authorization"] = auth

    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
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


def aidbox_fhir(path, method="GET", body=None):
    return json_request(AIDBOX_URL + "/fhir/" + path.lstrip("/"),
                        method=method, auth=AIDBOX_AUTH, body=body)


def mdmbox_api(path, method="GET", body=None):
    return json_request(MDMBOX_URL + (path if path.startswith("/") else "/" + path),
                        method=method, auth=MDMBOX_APP_AUTH, body=body)


def mdmbox_server_fhir(path, method="GET", body=None):
    return mdmbox_api("/fhir-server-api/" + path.lstrip("/"), method=method, body=body)


def assert_ok(result, label):
    if result["ok"]:
        return result
    raise RuntimeError("{} failed: HTTP {} {}".format(
        label, result["status"], stringify_short(result["body"])))


# ---------------------------------------------------------------------------
# Patient helpers
# ---------------------------------------------------------------------------
def read_aidbox_patient(pid):
    return aidbox_fhir("Patient/" + urllib.parse.quote(pid, safe=""))


def read_mdmbox_patient(pid):
    return mdmbox_server_fhir("Patient/" + urllib.parse.quote(pid, safe=""))


# ---------------------------------------------------------------------------
# Match + merge flow
# ---------------------------------------------------------------------------
def build_match_parameters(patient):
    return {
        "resourceType": "Parameters",
        "parameter": [
            {"name": "modelId", "valueString": MODEL_ID},
            {"name": "resource", "resource": patient},
            {"name": "onlySingleMatch", "valueBoolean": True},
        ],
    }


def run_mdmbox_match(patient):
    body = build_match_parameters(patient)
    result = mdmbox_api("/api/fhir/Patient/$match", method="POST", body=body)
    return body, result


def first_match(bundle):
    entry = None
    if isinstance(bundle, dict) and isinstance(bundle.get("entry"), list) and bundle["entry"]:
        entry = bundle["entry"][0]
    if not entry:
        return None
    resource = entry.get("resource") or {}
    pid = resource.get("id") or extract_id_from_full_url(entry.get("fullUrl") or "")
    if pid:
        result = dict(resource)
        result["id"] = pid
        return result
    return resource


def build_merge_parameters(source, target, entries, preview=False):
    return {
        "resourceType": "Parameters",
        "parameter": [
            {"name": "source", "valueReference": {"reference": source}},
            {"name": "target", "valueReference": {"reference": target}},
            {"name": "preview", "valueBoolean": preview is True},
            {"name": "plan", "resource": {
                "resourceType": "Bundle", "type": "transaction", "entry": entries}},
        ],
    }


def build_primitive_merge_plan(source_patient, target_patient):
    source_id = required_id(source_patient, "source patient")
    target_id = required_id(target_patient, "target patient")
    merged_target = merge_resource_prefer_target(source_patient, target_patient)

    put_entry = {
        "resource": merged_target,
        "request": {"method": "PUT", "url": "Patient/" + target_id},
    }
    target_etag = etag(target_patient)
    if target_etag:
        put_entry["request"]["ifMatch"] = target_etag

    delete_entry = {"request": {"method": "DELETE", "url": "Patient/" + source_id}}
    source_etag = etag(source_patient)
    if source_etag:
        delete_entry["request"]["ifMatch"] = source_etag

    return {
        "source": "Patient/" + source_id,
        "target": "Patient/" + target_id,
        "entries": [put_entry, delete_entry],
        "mergedTarget": merged_target,
    }


def run_mdmbox_merge(plan):
    body = build_merge_parameters(plan["source"], plan["target"], plan["entries"], preview=False)
    result = mdmbox_api("/api/fhir/$merge", method="POST", body=body)
    return body, result


def process_patient_created(notification, patient_ref):
    patient_id = required_id(patient_ref, "notification patient")
    with _flows_lock:
        existing = _flow_by_patient_id.get(patient_id)
        if existing and existing["status"] in ("no-match", "merged", "error"):
            add_step(existing, "duplicate delivery ignored", True)
            return existing
        flow = existing or new_flow(patient_id, notification)

    flow["status"] = "received"
    flow["notification"] = notification
    add_step(flow, "webhook received", True, {"patientId": patient_id})

    try:
        aidbox_patient = assert_ok(
            read_aidbox_patient(patient_id),
            "Read Patient/{} from Aidbox".format(patient_id))["body"]
        flow["patient"] = aidbox_patient
        add_step(flow, "patient read from Aidbox", True, {
            "id": aidbox_patient.get("id"),
            "versionId": (aidbox_patient.get("meta") or {}).get("versionId"),
        })

        flow["status"] = "matching"
        match_body, match_result = run_mdmbox_match(aidbox_patient)
        flow["matchRequest"] = match_body
        flow["matchResponse"] = match_result["body"]
        assert_ok(match_result, "$match")
        mbody = match_result["body"] if isinstance(match_result["body"], dict) else {}
        add_step(flow, "$match returned", True, {
            "onlySingleMatch": True,
            "total": mbody.get("total"),
            "entries": len(mbody["entry"]) if isinstance(mbody.get("entry"), list) else 0,
        })

        matched = first_match(match_result["body"])
        if not (matched and matched.get("id")):
            flow["status"] = "no-match"
            add_step(flow, "no match, merge skipped", True)
            return finish_flow(flow)

        target_read = assert_ok(
            read_mdmbox_patient(matched["id"]),
            "Read matched Patient/{} from mdmbox".format(matched["id"]))["body"]
        flow["matchedPatient"] = target_read
        add_step(flow, "matched patient read from mdmbox", True, {
            "id": target_read.get("id"),
            "versionId": (target_read.get("meta") or {}).get("versionId"),
        })

        plan = build_primitive_merge_plan(aidbox_patient, target_read)
        add_step(flow, "merge plan built", True, {
            "source": plan["source"], "target": plan["target"],
            "entries": len(plan["entries"]),
        })

        flow["status"] = "merging"
        merge_body, merge_result = run_mdmbox_merge(plan)
        flow["mergeRequest"] = merge_body
        flow["mergeResponse"] = merge_result["body"]
        assert_ok(merge_result, "$merge")
        merged_patient = assert_ok(
            read_mdmbox_patient(plan["target"].split("Patient/", 1)[-1]),
            "Read merged {} from mdmbox".format(plan["target"]))["body"]
        flow["mergedPatient"] = merged_patient
        flow["status"] = "merged"
        add_step(flow, "$merge applied", True, {
            "source": plan["source"], "target": plan["target"],
            "versionId": (merged_patient.get("meta") or {}).get("versionId"),
        })
        return finish_flow(flow)
    except Exception as e:  # noqa: BLE001 -- record any failure into the flow log
        flow["status"] = "error"
        flow["error"] = str(e)
        add_step(flow, "flow failed", False, flow["error"])
        return finish_flow(flow)


# ---------------------------------------------------------------------------
# Merge strategy (target wins scalars, arrays union, fill gaps from source)
# ---------------------------------------------------------------------------
def merge_resource_prefer_target(source, target):
    result = deep_clone(target)
    for key, source_value in source.items():
        if key in ("resourceType", "id", "meta"):
            continue
        result[key] = merge_value_prefer_target(source_value, result.get(key))
    result["resourceType"] = target.get("resourceType") or source.get("resourceType") or "Patient"
    result["id"] = target.get("id")
    if target.get("meta"):
        result["meta"] = target["meta"]
    return compact(result)


def merge_value_prefer_target(source_value, target_value):
    if isinstance(source_value, list) or isinstance(target_value, list):
        return union_unique(
            target_value if isinstance(target_value, list) else [],
            source_value if isinstance(source_value, list) else [],
        )
    if is_plain_object(source_value) and is_plain_object(target_value):
        result = deep_clone(target_value)
        for key, value in source_value.items():
            result[key] = merge_value_prefer_target(value, result.get(key))
        return compact(result)
    if is_filled(target_value):
        return target_value
    return deep_clone(source_value)


def union_unique(target_items, source_items):
    seen = set()
    result = []
    for item in list(target_items) + list(source_items):
        if not is_filled(item):
            continue
        key = stable_stringify(item)
        if key in seen:
            continue
        seen.add(key)
        result.append(deep_clone(item))
    return result


# ---------------------------------------------------------------------------
# Webhook notification parsing
# ---------------------------------------------------------------------------
def extract_patient_resources(payload):
    found = []
    seen = set()

    def visit(node, depth):
        if depth > 8 or node is None or not isinstance(node, (dict, list)):
            return
        if isinstance(node, list):
            for item in node:
                visit(item, depth + 1)
            return
        if node.get("resourceType") == "Patient":
            pid = node.get("id") or extract_reference_id(node.get("reference"))
            key = "Patient/" + pid if pid else stable_stringify(node)
            if key not in seen:
                seen.add(key)
                found.append(node)
        for k in ("resource", "notification", "notificationEvent", "entry", "focus",
                  "event", "events", "bundle", "body"):
            if node.get(k) is not None:
                visit(node[k], depth + 1)

    visit(payload, 0)
    return found


def extract_patient_references(payload):
    refs = []
    seen = set()

    def visit(node, depth):
        if depth > 8 or node is None or not isinstance(node, (dict, list)):
            return
        if isinstance(node, list):
            for item in node:
                visit(item, depth + 1)
            return
        reference = node.get("reference") if isinstance(node.get("reference"), str) else None
        pid = extract_reference_id(reference) if reference else None
        if pid and reference.startswith("Patient/") and pid not in seen:
            seen.add(pid)
            refs.append({"resourceType": "Patient", "id": pid})
        for value in node.values():
            visit(value, depth + 1)

    visit(payload, 0)
    return refs


# ---------------------------------------------------------------------------
# Flow log (call under _flows_lock for the create/lookup; step mutation is
# append-only on a flow the calling thread owns)
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


def extract_id_from_full_url(full_url):
    parts = str(full_url or "").split("/")
    return parts[-1] if parts else ""


def extract_reference_id(reference):
    if not isinstance(reference, str):
        return None
    if reference.startswith("Patient/"):
        rest = reference.split("Patient/", 1)[1]
        return rest.split("/", 1)[0] or None
    return None


def etag(resource):
    version_id = ((resource or {}).get("meta") or {}).get("versionId")
    return 'W/"{}"'.format(version_id) if version_id else None


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
        # Quieter default logging; keep the one-line access log.
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
            patients = extract_patient_resources(payload)
            refs = patients if patients else extract_patient_references(payload)

            if not refs:
                self._send_json({
                    "ok": True,
                    "ignored": True,
                    "reason": "No Patient resource or Patient reference found in webhook payload",
                })
                return

            processed = [process_patient_created(payload, ref) for ref in refs]
            self._send_json({
                "ok": all(f["status"] != "error" for f in processed),
                "processed": [{"id": f["id"], "patientId": f["patientId"], "status": f["status"]}
                              for f in processed],
            })
            return

        self._send_json({"ok": False, "error": "Not found"}, status=404)


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("mdmbox auto-merge handler app -> http://localhost:{}{}".format(PORT, WEBHOOK_PATH))
    print("Aidbox:  {}".format(AIDBOX_URL))
    print("mdmbox:  {}".format(MDMBOX_URL))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
