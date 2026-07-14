#!/usr/bin/env python3
"""mdmbox auto-merge example -- driver script.

Sets up the Aidbox subscription that notifies the auto-merge handler app on
Patient create, then creates a duplicate Patient and watches the handler app
merge it automatically.

  Aidbox --webhook--> auto-merge handler app --$match/$merge--> MDMbox

The handler app itself is a separate long-running service (see
auto_merge_handler_app.py); this script only drives the flow around it.

Runs the flow end to end as a plain script:

  1. PUT  /fhir/AidboxSubscriptionTopic/<id> -- topic for Patient/create.
  2. POST /fhir/AidboxTopicDestination       -- webhook destination -> handler app.
  3. PUT  /fhir/Patient/<main>               -- the existing Patient (survives).
  4. POST /fhir/Patient                       -- the new duplicate (triggers the
     webhook; the handler app runs $match + $merge on its own).
  5. GET  <handler>/api/events?patientId=<new> -- poll the handler's flow log
     until it reaches a terminal state (merged / no-match / error).
  6. GET  /fhir/Patient/<main>               -- read the merged survivor.

Fresh ids are generated for the patients on every run (override with
EXISTING_PATIENT_ID / NEW_PATIENT_ID) so re-running never merges into an
already-merged target. If any step fails the script stops and exits with 1.

Only the Python standard library is used.
"""

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

# The auto-merge handler app (a separate long-running service). Two URLs, and
# they are NOT the same address:
#   * WEBHOOK_ENDPOINT_URL is where *Aidbox* (in Docker) delivers the webhook --
#     the handler's in-network name, e.g. http://auto-merge-handler-app:3301/...
#   * AUTO_MERGE_HANDLER_APP_URL is where *this script* (on the host) reads the
#     flow log -- the host-visible address, http://localhost:3301.
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "aidbox-to-bun-secret")
# Default to the handler's in-network name: Aidbox (in Docker) delivers the
# webhook here, so this must resolve inside the compose network, not from the
# host. Override with WEBHOOK_ENDPOINT_URL=http://host.docker.internal:3301/...
# if you run the handler app directly on your host instead.
WEBHOOK_ENDPOINT_URL = os.environ.get(
    "WEBHOOK_ENDPOINT_URL", "http://auto-merge-handler-app:3301/webhooks/patient-created")
AUTO_MERGE_HANDLER_APP_URL = trim_slash(os.environ.get(
    "AUTO_MERGE_HANDLER_APP_URL", "http://localhost:3301"))

TOPIC_ID = os.environ.get("AIDBOX_TOPIC_ID", "mdmbox-patient-created")
TOPIC_URL = os.environ.get(
    "AIDBOX_TOPIC_URL", "http://mdmbox.example/SubscriptionTopic/" + TOPIC_ID)
DESTINATION_ID = os.environ.get("AIDBOX_DESTINATION_ID", "mdmbox-automerge-webhook")

# Fresh patient ids each run so re-running never merges into a stale target.
_RUN = uuid.uuid4().hex[:8]
EXISTING_PATIENT_ID = os.environ.get("EXISTING_PATIENT_ID", "main-jane-doe-" + _RUN)
NEW_PATIENT_ID = os.environ.get("NEW_PATIENT_ID", "incoming-jane-doe-" + _RUN)

# How long to wait for the async webhook -> $match -> $merge flow to finish.
# Aidbox delivers the webhook asynchronously (batched, at-least-once), so give
# it generous headroom -- the flow itself is fast once the event arrives.
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
    """Perform a JSON request. Never follows redirects.

    A 3xx here means the service is most likely not activated / needs login;
    following it would replay the request against "/" in a loop. Surface it.
    """
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
                "ok": False,
                "status": status,
                "url": url,
                "body": {
                    "error": (
                        "Server redirected this API call (HTTP "
                        + str(status)
                        + " -> "
                        + (location or "/")
                        + "). The service is most likely not activated or requires login. "
                        + "Activate Aidbox at "
                        + AIDBOX_URL
                        + " and mdmbox at "
                        + MDMBOX_URL
                        + ", then retry."
                    )
                },
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


def handler_app(path, method="GET", body=None):
    return json_request(
        AUTO_MERGE_HANDLER_APP_URL + (path if path.startswith("/") else "/" + path),
        method=method, body=body)


# ---------------------------------------------------------------------------
# Resource manifests
# ---------------------------------------------------------------------------
def aidbox_subscription_topic():
    return {
        "resourceType": "AidboxSubscriptionTopic",
        "id": TOPIC_ID,
        "url": TOPIC_URL,
        "status": "active",
        "trigger": [{"resource": "Patient", "supportedInteraction": ["create"]}],
    }


def aidbox_topic_destination():
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


def existing_patient():
    # The surviving target: an established record.
    return {
        "resourceType": "Patient",
        "id": EXISTING_PATIENT_ID,
        "active": True,
        "identifier": [{"system": "https://example.org/mrn", "value": "MRN-1000"}],
        "name": [{"use": "official", "given": ["Jane"], "family": "Doe"}],
        "birthDate": "1985-04-12",
        "gender": "female",
        "telecom": [
            {"system": "phone", "value": "+1-555-0100", "use": "mobile"},
            {"system": "email", "value": "jane.doe@example.org", "use": "home"},
        ],
        "address": [{"line": ["10 Market Street"], "city": "Boston",
                     "state": "MA", "postalCode": "02108", "country": "US"}],
    }


def incoming_patient():
    # The new duplicate. POSTed without an id so Aidbox assigns one -- that
    # create is what fires the webhook to the handler app.
    return {
        "resourceType": "Patient",
        "active": True,
        "identifier": [{"system": "https://example.org/mrn", "value": "MRN-2000"}],
        "name": [{"use": "official", "given": ["Jane"], "family": "Doe"}],
        "birthDate": "1985-04-12",
        "gender": "female",
        "telecom": [{"system": "phone", "value": "+1-555-0101", "use": "mobile"},
                    {"system": "email", "value": "jane.alt@example.org", "use": "home"}],
        "address": [{"city": "Boston"}],
    }


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------
def put_subscription_topic():
    topic = aidbox_subscription_topic()
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


def post_topic_destination():
    # AidboxTopicDestination is create-only (no update-by-id). If one already
    # exists but points at a different endpoint (e.g. a previous run used another
    # WEBHOOK_ENDPOINT_URL), delete it and recreate -- otherwise the stale
    # destination silently keeps receiving the webhooks.
    destination = aidbox_topic_destination()
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


def seed_existing_patient():
    patient = existing_patient()
    result = aidbox_fhir("Patient/" + urllib.parse.quote(EXISTING_PATIENT_ID, safe=""),
                         method="PUT", body=patient)
    return {"ok": result["ok"], "status": result["status"],
            "request": {"method": "PUT", "url": "Patient/" + EXISTING_PATIENT_ID,
                        "body": patient},
            "response": result["body"]}


def create_incoming_patient():
    patient = incoming_patient()
    result = aidbox_fhir("Patient", method="POST", body=patient)
    body = result["body"] if isinstance(result["body"], dict) else {}
    new_id = str(body.get("id") or "")
    return {"ok": result["ok"], "status": result["status"], "patientId": new_id,
            "request": {"method": "POST", "url": "Patient", "body": patient},
            "response": result["body"]}


_TERMINAL = ("merged", "no-match", "error")


def merge_target_id(flow):
    """The id of the patient the incoming duplicate was merged into, read from
    the handler's flow log (mergedPatient, else the merge request's target)."""
    if not isinstance(flow, dict):
        return None
    merged = flow.get("mergedPatient")
    if isinstance(merged, dict) and merged.get("id"):
        return str(merged["id"])
    req = flow.get("mergeRequest")
    if isinstance(req, dict):
        for p in req.get("parameter", []):
            if p.get("name") == "target":
                ref = (p.get("valueReference") or {}).get("reference") or ""
                if ref.startswith("Patient/"):
                    return ref.split("Patient/", 1)[1]
    return None


def poll_events(patient_id):
    """Poll the handler app's flow log until the flow for patient_id reaches a
    terminal state, or the timeout elapses."""
    deadline = time.monotonic() + POLL_TIMEOUT_S
    last = None
    path = "/api/events?patientId=" + urllib.parse.quote(patient_id, safe="")
    while True:
        result = handler_app(path)
        last = result
        events = (result["body"] or {}).get("events") if isinstance(result["body"], dict) else None
        flow = events[0] if isinstance(events, list) and events else None
        status = flow.get("status") if isinstance(flow, dict) else None
        if status in _TERMINAL:
            return {"ok": result["ok"] and status != "error", "status": result["status"],
                    "patientId": patient_id, "flowStatus": status,
                    # The auto-merge target is chosen by $match, not by us -- surface
                    # which patient the incoming duplicate was merged into.
                    "mergeTargetId": merge_target_id(flow),
                    "request": {"method": "GET", "url": AUTO_MERGE_HANDLER_APP_URL + path},
                    "response": result["body"]}
        if time.monotonic() >= deadline:
            return {"ok": False, "status": result["status"], "patientId": patient_id,
                    "flowStatus": status or "pending",
                    "error": "Timed out after {:.0f}s waiting for the auto-merge flow "
                             "(status: {}). Is the handler app running?".format(
                                 POLL_TIMEOUT_S, status or "no events yet"),
                    "request": {"method": "GET", "url": AUTO_MERGE_HANDLER_APP_URL + path},
                    "response": result["body"]}
        time.sleep(POLL_INTERVAL_S)


def read_aidbox_patient(pid):
    result = aidbox_fhir("Patient/" + urllib.parse.quote(pid, safe=""))
    return {"ok": result["ok"], "status": result["status"],
            "request": {"method": "GET", "url": "Patient/" + pid},
            "response": result["body"]}


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
    # An explicit `note` means the step intentionally accepted a non-2xx (e.g. a
    # re-run's "already exists") -- honor its ok and don't flag the OO as error.
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
        mark = color("HTTP {}".format(status if status is not None else "error"),
                     _RED, _BOLD)
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
    print("mdmbox auto-merge example (driver)")
    print("Aidbox:  {}  (subscription + patients)".format(AIDBOX_URL))
    print("mdmbox:  {}  ($match / $merge, via the handler app)".format(MDMBOX_URL))
    print("handler: {}  (separate long-running webhook service)".format(AUTO_MERGE_HANDLER_APP_URL))
    print("existing Patient/{} survives; a duplicate is auto-merged into it"
          .format(EXISTING_PATIENT_ID))

    # Step 1: subscription topic for Patient/create.
    step(1, "PUT AidboxSubscriptionTopic/{}".format(TOPIC_ID), put_subscription_topic())

    # Step 2: webhook destination -> the handler app.
    step(2, "POST AidboxTopicDestination/{} (webhook -> handler app)".format(DESTINATION_ID),
         post_topic_destination())

    # Step 3: the existing (surviving) patient.
    step(3, "PUT Patient/{} (existing, survives)".format(EXISTING_PATIENT_ID),
         seed_existing_patient())

    # Step 4: the new duplicate -- this create fires the webhook.
    created = step(4, "POST Patient (new duplicate -- fires the webhook)",
                   create_incoming_patient())
    new_id = created.get("patientId")

    # Step 5: wait for the handler app to $match + $merge asynchronously.
    flow = step(5, "GET handler /api/events?patientId={} (await auto-merge)".format(new_id or "?"),
                poll_events(new_id))

    # Step 6: read the merged survivor back. The target is chosen by $match, so
    # use the merge target the handler reported (falling back to our seeded one).
    survivor_id = flow.get("mergeTargetId") or EXISTING_PATIENT_ID
    note = "" if survivor_id == EXISTING_PATIENT_ID else " (matched an existing record)"
    step(6, "GET Patient/{} (merged survivor{})".format(survivor_id, note),
         read_aidbox_patient(survivor_id))

    print("\n" + color("All steps completed.", _GREEN, _BOLD))


if __name__ == "__main__":
    main()
