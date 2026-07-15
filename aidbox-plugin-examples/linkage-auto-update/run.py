#!/usr/bin/env python3
"""mdmbox linkage-auto-update example -- driver script.

Links two source Patients under a profiled Linkage whose `contained` holds a
golden (survivorship) view, then subscribes to Patient/update so that whenever a
source record changes, a handler app rebuilds the golden view in the Linkage.

  Aidbox --webhook (Patient/update)--> update handler --PUT Linkage--> Aidbox

The handler is a separate long-running service (see update_handler.py); this
script only drives the flow around it.

Runs the flow end to end as a plain script:

  1. PUT Patient/<A> into Aidbox -- source A (has an address, no phone).
  2. PUT Patient/<B> into Aidbox -- source B (has a phone, no address; same name).
  3. POST mdmbox $link -- group both under a profiled Linkage whose contained
     golden view unions their fields.
  4. PUT  /fhir/AidboxSubscriptionTopic/<id> -- topic for Patient/update.
     POST /fhir/AidboxTopicDestination        -- webhook destination -> handler.
  5. PUT Patient/<A> (updated) -- add a new field; this update fires the webhook,
     and the handler rebuilds the Linkage's golden view.
  6. GET handler /api/events?patientId=<A> -- poll until the rebuild finishes.
  7. GET Linkage -- read the Linkage back and show the refreshed golden view.

Fresh patient ids are generated on every run (override with A_ID / B_ID) so the
"one active Linkage per reference" rule never conflicts. If any step fails the
script stops and exits with status 1.

Only the Python standard library is used.
"""

import copy
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def trim_slash(s: str) -> str:
    return s.rstrip("/")


AIDBOX_URL = trim_slash(os.environ.get("AIDBOX_URL", "http://localhost:8888"))
AIDBOX_AUTH = os.environ.get("AIDBOX_AUTH", "Basic cm9vdDpyb290")  # root:root

MDMBOX_URL = trim_slash(os.environ.get("MDMBOX_URL", "http://localhost:3003"))
MDMBOX_AUTH = os.environ.get("MDMBOX_AUTH", "Basic cm9vdDpyb290")  # root:root

LINK_PATH = "/api/fhir/$link"

LINKAGE_PROFILE = "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage"
GOLDEN_ID = "golden"

# The update handler (a separate long-running service). Two URLs, NOT the same
# address:
#   * WEBHOOK_ENDPOINT_URL is where Aidbox (in Docker) delivers the webhook --
#     the handler's in-network name. Override with host.docker.internal if you
#     run the handler directly on your host.
#   * UPDATE_HANDLER_URL is where this script (on the host) reads the flow log.
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "aidbox-to-handler-secret")
WEBHOOK_ENDPOINT_URL = os.environ.get(
    "WEBHOOK_ENDPOINT_URL", "http://update-handler:3302/webhooks/patient-updated")
UPDATE_HANDLER_URL = trim_slash(os.environ.get("UPDATE_HANDLER_URL", "http://localhost:3302"))

TOPIC_ID = os.environ.get("AIDBOX_TOPIC_ID", "mdmbox-patient-updated")
TOPIC_URL = os.environ.get(
    "AIDBOX_TOPIC_URL", "http://mdmbox.example/SubscriptionTopic/" + TOPIC_ID)
DESTINATION_ID = os.environ.get("AIDBOX_DESTINATION_ID", "mdmbox-linkage-update-webhook")

# Fresh patient ids each run.
_RUN = uuid.uuid4().hex[:8]
A_ID = os.environ.get("A_ID", "lau-a-" + _RUN)
B_ID = os.environ.get("B_ID", "lau-b-" + _RUN)
A_REF = "Patient/" + A_ID
B_REF = "Patient/" + B_ID

POLL_TIMEOUT_S = float(os.environ.get("POLL_TIMEOUT_S", "45"))
POLL_INTERVAL_S = float(os.environ.get("POLL_INTERVAL_S", "1"))


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


def json_request(url, method="GET", auth=None, body=None):
    headers = {"accept": "application/json"}
    data = None
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if auth:
        headers["authorization"] = auth

    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(_NoRedirect)

    try:
        with opener.open(req) as res:
            text = res.read().decode("utf-8", "replace")
            status = res.status
            return {"ok": 200 <= status < 300, "status": status, "url": url,
                    "body": safe_json(text), "text": text}
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        status = e.code
        if 300 <= status < 400:
            location = e.headers.get("location", "") or ""
            return {
                "ok": False, "status": status, "url": url,
                "body": {"error": (
                    "Server redirected this API call (HTTP " + str(status) + " -> "
                    + (location or "/") + "). The service is most likely not activated "
                    "or requires login. Activate Aidbox at " + AIDBOX_URL
                    + " and mdmbox at " + MDMBOX_URL + ", then retry.")},
                "text": text,
            }
        return {"ok": False, "status": status, "url": url,
                "body": safe_json(text), "text": text}
    except urllib.error.URLError as e:
        return {"ok": False, "status": 0, "url": url,
                "body": {"error": "Request failed: " + str(e.reason)}, "text": ""}


def aidbox_fhir(path, method="GET", body=None):
    return json_request(AIDBOX_URL + "/fhir/" + path.lstrip("/"),
                        method=method, auth=AIDBOX_AUTH, body=body)


def mdmbox(path, method="GET", body=None):
    return json_request(MDMBOX_URL + (path if path.startswith("/") else "/" + path),
                        method=method, auth=MDMBOX_AUTH, body=body)


def handler_app(path, method="GET", body=None):
    return json_request(
        UPDATE_HANDLER_URL + (path if path.startswith("/") else "/" + path),
        method=method, body=body)


# ---------------------------------------------------------------------------
# Sample patients (same person, complementary fields)
# ---------------------------------------------------------------------------
def patient_a():
    # Source A: has an address, no phone.
    return {
        "resourceType": "Patient",
        "id": A_ID,
        "active": True,
        "identifier": [{"system": "https://example.org/mrn", "value": "MRN-1000"}],
        "name": [{"use": "official", "given": ["Jane"], "family": "Doe"}],
        "birthDate": "1985-04-12",
        "gender": "female",
        "address": [{"line": ["10 Market Street"], "city": "Boston",
                     "state": "MA", "postalCode": "02108", "country": "US"}],
    }


def patient_b():
    # Source B: has a phone, no address; same name.
    return {
        "resourceType": "Patient",
        "id": B_ID,
        "active": True,
        "identifier": [{"system": "https://example.org/mrn", "value": "MRN-2000"}],
        "name": [{"use": "official", "given": ["Jane"], "family": "Doe"}],
        "birthDate": "1985-04-12",
        "gender": "female",
        "telecom": [{"system": "phone", "value": "+1-555-0101", "use": "mobile"}],
    }


# The initial golden view: union of A and B (address from A, phone from B).
def initial_golden():
    return rebuild_golden([patient_a(), patient_b()])


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------
def put_patient(patient):
    pid = str(patient["id"])
    result = aidbox_fhir("Patient/" + urllib.parse.quote(pid, safe=""),
                         method="PUT", body=patient)
    return {"ok": result["ok"], "status": result["status"],
            "request": {"method": "PUT", "url": "Patient/" + pid, "body": patient},
            "response": result["body"]}


def linkage_resource():
    return {
        "resourceType": "Linkage",
        "meta": {"profile": [LINKAGE_PROFILE]},
        "active": True,
        "contained": [initial_golden()],
        "item": [
            {"type": "source", "resource": {"reference": "#" + GOLDEN_ID}},
            {"type": "alternate", "resource": {"reference": A_REF}},
            {"type": "alternate", "resource": {"reference": B_REF}},
        ],
    }


def run_link():
    entries = [{
        "fullUrl": "urn:uuid:" + str(uuid.uuid4()),
        "request": {"method": "POST", "url": "Linkage"},
        "resource": linkage_resource(),
    }]
    body = {"resourceType": "Parameters", "parameter": [
        {"name": "plan", "resource": {
            "resourceType": "Bundle", "type": "transaction", "entry": entries}},
        {"name": "preview", "valueBoolean": False},
    ]}
    result = mdmbox(LINK_PATH, method="POST", body=body)
    return {"ok": result["ok"], "status": result["status"], "via": MDMBOX_URL + LINK_PATH,
            "request": {"method": "POST", "url": LINK_PATH, "body": body},
            "response": result["body"]}


def put_subscription_topic():
    topic = {
        "resourceType": "AidboxSubscriptionTopic",
        "id": TOPIC_ID,
        "url": TOPIC_URL,
        "status": "active",
        "trigger": [{"resource": "Patient", "supportedInteraction": ["update"]}],
    }
    result = aidbox_fhir("AidboxSubscriptionTopic/" + urllib.parse.quote(TOPIC_ID, safe=""),
                         method="PUT", body=topic)
    return {"ok": result["ok"], "status": result["status"],
            "request": {"method": "PUT", "url": "AidboxSubscriptionTopic/" + TOPIC_ID,
                        "body": topic},
            "response": result["body"]}


def _destination_endpoint(dest):
    if not isinstance(dest, dict):
        return None
    for p in dest.get("parameter", []):
        if p.get("name") == "endpoint":
            return p.get("valueUrl")
    return None


def topic_destination_resource():
    return {
        "resourceType": "AidboxTopicDestination",
        "id": DESTINATION_ID,
        "meta": {"profile": [
            "http://aidbox.app/StructureDefinition/aidboxtopicdestination-webhook-at-least-once"]},
        "status": "active",
        "kind": "webhook-at-least-once",
        "topic": TOPIC_URL,
        "content": "full-resource",
        "includeEntryAction": True,
        "includeVersionId": True,
        "parameter": [
            {"name": "endpoint", "valueUrl": WEBHOOK_ENDPOINT_URL},
            {"name": "header", "valueString": "Authorization: Bearer " + WEBHOOK_SECRET},
        ],
    }


def post_topic_destination():
    # AidboxTopicDestination is create-only (no update-by-id). If one already
    # exists but points at a different endpoint, delete + recreate so the stale
    # destination does not silently keep receiving the webhooks.
    destination = topic_destination_resource()
    existing = aidbox_fhir("AidboxTopicDestination/" + urllib.parse.quote(DESTINATION_ID, safe=""))
    if existing["ok"]:
        if _destination_endpoint(existing["body"]) == WEBHOOK_ENDPOINT_URL:
            return {"ok": True, "status": existing["status"],
                    "note": "already exists with the same endpoint (reusing it)",
                    "request": {"method": "GET", "url": "AidboxTopicDestination/" + DESTINATION_ID},
                    "response": existing["body"]}
        aidbox_fhir("AidboxTopicDestination/" + urllib.parse.quote(DESTINATION_ID, safe=""),
                    method="DELETE")
    result = aidbox_fhir("AidboxTopicDestination", method="POST", body=destination)
    return {"ok": result["ok"], "status": result["status"],
            "request": {"method": "POST", "url": "AidboxTopicDestination", "body": destination},
            "response": result["body"]}


def update_patient_a():
    # Add a new field to source A (an email). This update fires the webhook.
    patient = patient_a()
    patient["telecom"] = [{"system": "email", "value": "jane.doe@example.org", "use": "home"}]
    result = aidbox_fhir("Patient/" + urllib.parse.quote(A_ID, safe=""),
                         method="PUT", body=patient)
    return {"ok": result["ok"], "status": result["status"],
            "request": {"method": "PUT", "url": "Patient/" + A_ID, "body": patient},
            "response": result["body"]}


_TERMINAL = ("updated", "no-linkage", "error")


def poll_events(patient_id, since_version=None):
    """Poll the handler's flow log until the flow for patient_id reaches a
    terminal state, or the timeout elapses."""
    deadline = time.monotonic() + POLL_TIMEOUT_S
    path = "/api/events?patientId=" + urllib.parse.quote(patient_id, safe="")
    while True:
        result = handler_app(path)
        events = (result["body"] or {}).get("events") if isinstance(result["body"], dict) else None
        flow = events[0] if isinstance(events, list) and events else None
        status = flow.get("status") if isinstance(flow, dict) else None
        if status in _TERMINAL:
            return {"ok": result["ok"] and status != "error", "status": result["status"],
                    "patientId": patient_id, "flowStatus": status,
                    "request": {"method": "GET", "url": UPDATE_HANDLER_URL + path},
                    "response": result["body"]}
        if time.monotonic() >= deadline:
            return {"ok": False, "status": result["status"], "patientId": patient_id,
                    "flowStatus": status or "pending",
                    "error": "Timed out after {:.0f}s waiting for the update flow (status: {}). "
                             "Is the handler app running?".format(
                                 POLL_TIMEOUT_S, status or "no events yet"),
                    "request": {"method": "GET", "url": UPDATE_HANDLER_URL + path},
                    "response": result["body"]}
        time.sleep(POLL_INTERVAL_S)


def get_linkage():
    result = aidbox_fhir("Linkage?item=" + urllib.parse.quote(A_REF, safe=""))
    linkage = first_resource(result["body"])
    return {"ok": result["ok"] and linkage is not None, "status": result["status"],
            "request": {"method": "GET", "url": "Linkage?item=" + A_REF},
            "response": linkage if linkage is not None else result["body"]}


# ---------------------------------------------------------------------------
# Golden rebuild (shared with the handler's logic, for the initial golden)
# ---------------------------------------------------------------------------
def rebuild_golden(source_patients):
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
            incoming if isinstance(incoming, list) else [])
    if is_plain_object(incoming) and is_plain_object(current):
        result = deep_clone(current)
        for key, value in incoming.items():
            result[key] = merge_value(value, result.get(key))
        return compact(result)
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


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------
def first_resource(searchset):
    if not isinstance(searchset, dict):
        return None
    entry = searchset.get("entry")
    if isinstance(entry, list) and entry:
        return entry[0].get("resource")
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
    if isinstance(value, (list, tuple, dict)):
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
            json.dumps(k) + ":" + stable_stringify(value[k]) for k in sorted(value.keys())
        ) + "}"
    return json.dumps(value)


# ---------------------------------------------------------------------------
# Script driver
# ---------------------------------------------------------------------------
_COLOR = sys.stdout.isatty() and not os.environ.get("NO_COLOR")
_RESET = "\033[0m"
_RED = "\033[31m"
_GREEN = "\033[32m"
_BOLD = "\033[1m"


def color(text, *codes):
    if not _COLOR or not codes:
        return text
    return "".join(codes) + text + _RESET


def outcome_error(body):
    if not isinstance(body, dict):
        return None
    if body.get("resourceType") == "OperationOutcome":
        for issue in body.get("issue", []):
            if isinstance(issue, dict) and issue.get("severity") in ("error", "fatal"):
                details = issue.get("details") or {}
                return (details.get("text") or issue.get("diagnostics")
                        or issue.get("code") or "OperationOutcome error")
    return None


def print_step(num, title, result):
    err = outcome_error(result.get("response"))
    if result.get("note") and result.get("ok"):
        err = None
    ok = bool(result.get("ok")) and err is None
    status = result.get("status")
    if ok:
        mark = color("OK", _GREEN, _BOLD)
    elif err:
        mark = color("ERROR: " + err, _RED, _BOLD)
    elif result.get("error"):
        mark = color("ERROR: " + str(result["error"]), _RED, _BOLD)
    else:
        mark = color("HTTP {}".format(status if status is not None else "error"), _RED, _BOLD)
    print("\n" + "=" * 72)
    print("Step {}: {}  [{}]".format(num, title, mark))
    print("-" * 72)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return ok


def step(num, title, result):
    if not print_step(num, title, result):
        print("\n" + color("Step {} failed -- aborting.".format(num), _RED, _BOLD))
        raise SystemExit(1)
    return result


def main():
    print("mdmbox linkage-auto-update example (driver)")
    print("Aidbox:  {}  (patients + Linkage + subscription)".format(AIDBOX_URL))
    print("mdmbox:  {}  ($link)".format(MDMBOX_URL))
    print("handler: {}  (separate long-running webhook service)".format(UPDATE_HANDLER_URL))
    print("sources {} and {} link into a golden view; updating one refreshes it"
          .format(A_REF, B_REF))

    # Step 1 & 2: create the two complementary source records.
    step(1, "PUT {} (source A: address, no phone)".format(A_REF), put_patient(patient_a()))
    step(2, "PUT {} (source B: phone, no address)".format(B_REF), put_patient(patient_b()))

    # Step 3: link them with a golden view in contained.
    step(3, "POST $link (Linkage with unioned golden view)", run_link())

    # Step 4: subscribe to Patient/update, delivering to the handler.
    step(4, "PUT AidboxSubscriptionTopic/{} (Patient/update)".format(TOPIC_ID),
         put_subscription_topic())
    step(5, "POST AidboxTopicDestination/{} (webhook -> handler)".format(DESTINATION_ID),
         post_topic_destination())

    # Step 6: update source A -- this fires the webhook.
    step(6, "PUT {} (update: add email -- fires the webhook)".format(A_REF), update_patient_a())

    # Step 7: wait for the handler to rebuild the golden view.
    step(7, "GET handler /api/events?patientId={} (await golden rebuild)".format(A_ID),
         poll_events(A_ID))

    # Step 8: read the Linkage back and show the refreshed golden view.
    step(8, "GET Linkage?item={} (refreshed golden view)".format(A_REF), get_linkage())

    print("\n" + color("All steps completed.", _GREEN, _BOLD))


if __name__ == "__main__":
    main()
