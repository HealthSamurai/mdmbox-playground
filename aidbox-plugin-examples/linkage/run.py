#!/usr/bin/env python3
"""mdmbox linkage example -- $link / $unlink THROUGH Aidbox + mdmbox.

Demonstrates the non-destructive $link / $unlink operations: two source Patient
records are grouped by a profiled Linkage resource that also carries a golden
(survivorship) view in its `contained`. Neither source is ever modified --
unlike $merge, nothing is rewritten or deleted. The link is then reversed with
$unlink, which removes the Linkage and leaves both sources untouched.

This is the Aidbox-plugin flavour of the example: patients and the Linkage are
created/read through Aidbox's FHIR API, while the $link / $unlink operations go
to mdmbox (which shares the same database).

Runs the flow end to end as a plain script:

  1. PUT Patient/<A> into Aidbox (source record A).
  2. PUT Patient/<B> into Aidbox (source record B -- same person).
  3. POST mdmbox $link -- groups both under one profiled Linkage carrying a
     golden view; the sources are not touched.
  4. GET the Linkage back from Aidbox (search by member reference).
  5. POST mdmbox $unlink -- reverses the link (DELETEs the Linkage); both
     patients remain and the references are free to link again.

Fresh patient ids are generated on every run (override with A_ID / B_ID) so the
"one active Linkage per reference" rule never conflicts on a re-run. If any step
fails the script stops and exits with status 1.

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
MDMBOX_AUTH = os.environ.get("MDMBOX_AUTH", "Basic cm9vdDpyb290")  # root:root

# The $link / $unlink operations (mounted under /api/fhir in mdmbox).
LINK_PATH = "/api/fhir/$link"
UNLINK_PATH = "/api/fhir/$unlink"

# The two source records to link (they refer to the same person). Fresh ids each
# run so re-linking never hits the "one active Linkage per reference" 409.
_RUN = uuid.uuid4().hex[:8]
A_ID = os.environ.get("A_ID", "link-a-" + _RUN)
B_ID = os.environ.get("B_ID", "link-b-" + _RUN)
A_REF = "Patient/" + A_ID
B_REF = "Patient/" + B_ID

# The dedicated profile that marks a Linkage as mdmbox-managed. $link requires it
# (it defines the namespace for the "one active Linkage per reference" rule).
LINKAGE_PROFILE = "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage"

# The golden (survivorship) view lives inside the Linkage `contained`.
GOLDEN_ID = "golden"


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

    # An opener with no redirect handler raises HTTPError on 3xx instead of
    # following it -- the equivalent of fetch's redirect:"manual".
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


def mdmbox(path, method="GET", body=None):
    """Call mdmbox (used for $link / $unlink)."""
    return json_request(
        MDMBOX_URL + (path if path.startswith("/") else "/" + path),
        method=method,
        auth=MDMBOX_AUTH,
        body=body,
    )


# Patients and the Linkage are created/read through Aidbox's FHIR API.
def aidbox_fhir(path, method="GET", body=None):
    return json_request(
        AIDBOX_URL + "/fhir/" + path.lstrip("/"),
        method=method,
        auth=AIDBOX_AUTH,
        body=body,
    )


# ---------------------------------------------------------------------------
# Sample patients (two records referring to the same person)
# ---------------------------------------------------------------------------
def patient_a():
    return {
        "resourceType": "Patient",
        "id": A_ID,
        "active": True,
        "identifier": [{"system": "https://example.org/mrn", "value": "MRN-1000"}],
        "name": [{"use": "official", "given": ["Jane"], "family": "Doe"}],
        "birthDate": "1985-04-12",
        "gender": "female",
        "telecom": [{"system": "email", "value": "jane.doe@example.org", "use": "home"}],
        "address": [{"city": "Boston", "state": "MA", "country": "US"}],
    }


def patient_b():
    return {
        "resourceType": "Patient",
        "id": B_ID,
        "active": True,
        "identifier": [{"system": "https://example.org/mrn", "value": "MRN-2000"}],
        "name": [{"use": "official", "given": ["Jane"], "family": "Doe"}],
        "birthDate": "1985-04-12",
        "gender": "female",
        "telecom": [{"system": "phone", "value": "+1-555-0101", "use": "mobile"}],
        "address": [{"city": "Boston", "state": "MA", "country": "US"}],
    }


# The golden view: a survivorship record combining the best fields of both
# sources. It lives *inside* the Linkage (`contained`), not as a stored resource
# -- it has a local `id` and carries no meta.versionId/lastUpdated/security.
# mdmbox never recalculates it; the client owns it.
def golden_patient():
    return {
        "resourceType": "Patient",
        "id": GOLDEN_ID,
        "active": True,
        # Survivorship: keep both source MRNs so the golden record traces back.
        "identifier": [
            {"system": "https://example.org/mrn", "value": "MRN-1000"},
            {"system": "https://example.org/mrn", "value": "MRN-2000"},
        ],
        "name": [{"use": "official", "given": ["Jane"], "family": "Doe"}],
        "birthDate": "1985-04-12",
        "gender": "female",
        # Both contact points survive (email from A, phone from B).
        "telecom": [
            {"system": "email", "value": "jane.doe@example.org", "use": "home"},
            {"system": "phone", "value": "+1-555-0101", "use": "mobile"},
        ],
        "address": [{"city": "Boston", "state": "MA", "country": "US"}],
    }


# Step 1 / Step 2: create a patient in Aidbox (PUT with explicit id = upsert).
def put_patient(patient):
    pid = required_id(patient, "patient")
    result = aidbox_fhir("Patient/" + urllib.parse.quote(pid, safe=""),
                         method="PUT", body=patient)
    return {
        "ok": result["ok"],
        "status": result["status"],
        "request": {"method": "PUT", "url": "Patient/" + pid, "body": patient},
        "response": result["body"],
    }


# ---------------------------------------------------------------------------
# Link: POST a profiled Linkage grouping the two records (no source modified)
# ---------------------------------------------------------------------------
def linkage_resource():
    # The profile allows one contained golden view, named by the single `source`
    # item (`#golden`). The untouched source Patients become `alternate` members.
    return {
        "resourceType": "Linkage",
        "meta": {"profile": [LINKAGE_PROFILE]},
        "active": True,
        "contained": [golden_patient()],
        "item": [
            {"type": "source", "resource": {"reference": "#" + GOLDEN_ID}},
            {"type": "alternate", "resource": {"reference": A_REF}},
            {"type": "alternate", "resource": {"reference": B_REF}},
        ],
    }


def build_link_parameters(entries, preview):
    # $link body: just { plan, preview } -- the client owns the plan, there is no
    # source/target.
    return {
        "resourceType": "Parameters",
        "parameter": [
            {"name": "plan", "resource": {
                "resourceType": "Bundle", "type": "transaction", "entry": entries}},
            {"name": "preview", "valueBoolean": preview},
        ],
    }


# Step 3: run mdmbox $link.
def run_link():
    a_read = aidbox_fhir("Patient/" + urllib.parse.quote(A_ID, safe=""))
    if not a_read["ok"]:
        return {"ok": False, "status": a_read["status"],
                "error": A_REF + " not found in Aidbox", "response": a_read["body"]}
    b_read = aidbox_fhir("Patient/" + urllib.parse.quote(B_ID, safe=""))
    if not b_read["ok"]:
        return {"ok": False, "status": b_read["status"],
                "error": B_REF + " not found in Aidbox", "response": b_read["body"]}

    # A POST entry carries a urn:uuid fullUrl so the audit Provenance can point
    # at the Linkage the transaction creates.
    entries = [{
        "fullUrl": "urn:uuid:" + str(uuid.uuid4()),
        "request": {"method": "POST", "url": "Linkage"},
        "resource": linkage_resource(),
    }]
    body = build_link_parameters(entries, preview=False)

    started = time.perf_counter()
    result = mdmbox(LINK_PATH, method="POST", body=body)
    elapsed_ms = round((time.perf_counter() - started) * 1000)

    return {
        "ok": result["ok"],
        "status": result["status"],
        "via": MDMBOX_URL + LINK_PATH,
        "elapsedMs": elapsed_ms,
        "request": {"method": "POST", "url": LINK_PATH, "body": body},
        "response": result["body"],
    }


# Step 4: read the created Linkage back (search by member reference).
def get_linkage():
    result = aidbox_fhir("Linkage?item=" + urllib.parse.quote(A_REF, safe=""))
    linkage = first_resource(result["body"])
    return {
        "ok": result["ok"] and linkage is not None,
        "status": result["status"],
        "request": {"method": "GET", "url": "Linkage?item=" + A_REF},
        "response": linkage if linkage is not None else result["body"],
    }


# ---------------------------------------------------------------------------
# Unlink: DELETE the Linkage (a profiled Linkage is fixed active=true, so it
# cannot be deactivated in place; its history is preserved via /_history).
# ---------------------------------------------------------------------------
def find_active_linkage():
    result = aidbox_fhir("Linkage?item=" + urllib.parse.quote(A_REF, safe=""))
    for e in (result["body"] or {}).get("entry", []) if isinstance(result["body"], dict) else []:
        linkage = e.get("resource") or {}
        profiles = (linkage.get("meta") or {}).get("profile") or []
        if linkage.get("active") is not False and LINKAGE_PROFILE in profiles:
            return linkage
    return None


def find_link_task():
    result = aidbox_fhir("Task?code=link")
    for e in (result["body"] or {}).get("entry", []) if isinstance(result["body"], dict) else []:
        task = e.get("resource") or {}
        coding = (task.get("businessStatus") or {}).get("coding") or []
        linked = any(c.get("code") == "linked" for c in coding)
        refs_a = any((i.get("valueReference") or {}).get("reference") == A_REF
                     for i in (task.get("input") or []))
        if linked and refs_a:
            return task
    return None


# Step 5: run mdmbox $unlink.
def run_unlink():
    linkage = find_active_linkage()
    if not linkage:
        return {"ok": False, "status": 404,
                "error": "No active Linkage found -- run Step 3 ($link) first."}
    task = find_link_task()
    if not task:
        return {"ok": False, "status": 404,
                "error": "No active link Task found -- run Step 3 ($link) first."}

    body = {
        "resourceType": "Parameters",
        "parameter": [
            {"name": "task", "valueReference": {"reference": "Task/" + task["id"]}},
            {"name": "preview", "valueBoolean": False},
            {"name": "plan", "resource": {
                "resourceType": "Bundle",
                "type": "transaction",
                "entry": [{"request": {"method": "DELETE",
                                       "url": "Linkage/" + linkage["id"]}}],
            }},
        ],
    }

    started = time.perf_counter()
    result = mdmbox(UNLINK_PATH, method="POST", body=body)
    elapsed_ms = round((time.perf_counter() - started) * 1000)

    return {
        "ok": result["ok"],
        "status": result["status"],
        "via": MDMBOX_URL + UNLINK_PATH,
        "elapsedMs": elapsed_ms,
        "request": {"method": "POST", "url": UNLINK_PATH, "body": body},
        "response": result["body"],
    }


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


def required_id(resource, label):
    pid = str((resource or {}).get("id") or "").strip()
    if not pid:
        raise ValueError(label + " must have id")
    return pid


# ---------------------------------------------------------------------------
# Script driver
# ---------------------------------------------------------------------------
# ANSI colors -- disabled when stdout is not a TTY or NO_COLOR is set.
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
    """Return an OperationOutcome error message if the body reports one.

    A service can return HTTP 200 with an error-severity OperationOutcome, so an
    HTTP 200 alone is not enough to call a step successful.
    """
    if not isinstance(body, dict):
        return None
    if body.get("resourceType") == "OperationOutcome":
        for issue in body.get("issue", []):
            if isinstance(issue, dict) and issue.get("severity") in ("error", "fatal"):
                details = issue.get("details") or {}
                return (details.get("text")
                        or issue.get("diagnostics")
                        or issue.get("code")
                        or "OperationOutcome error")
    return None


def print_step(num, title, result):
    err = outcome_error(result.get("response"))
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
    """Print a step; abort the run (SystemExit 1) if it failed. Returns result."""
    if not print_step(num, title, result):
        print("\n" + color("Step {} failed -- aborting.".format(num), _RED, _BOLD))
        raise SystemExit(1)
    return result


def main():
    print("mdmbox linkage example ($link / $unlink)")
    print("Aidbox: {}  (create/read patients + Linkage)".format(AIDBOX_URL))
    print("mdmbox: {}  ($link / $unlink)".format(MDMBOX_URL))
    print("sources {} and {} stay intact the whole time".format(A_REF, B_REF))

    # Step 1: create source record A.
    step(1, "PUT {} (record A)".format(A_REF), put_patient(patient_a()))

    # Step 2: create source record B (same person).
    step(2, "PUT {} (record B)".format(B_REF), put_patient(patient_b()))

    # Step 3: $link -- group both under one profiled Linkage.
    step(3, "POST $link (group under a profiled Linkage)", run_link())

    # Step 4: read the created Linkage back.
    step(4, "GET Linkage?item={} (the link)".format(A_REF), get_linkage())

    # Step 5: $unlink -- reverse the link (DELETEs the Linkage).
    step(5, "POST $unlink (reverse the link)", run_unlink())

    print("\n" + color("All steps completed.", _GREEN, _BOLD))


if __name__ == "__main__":
    main()
