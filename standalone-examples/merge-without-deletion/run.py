#!/usr/bin/env python3
"""mdmbox merge-without-deletion example (standalone).

Everything goes through mdmbox -- the script never talks to Aidbox directly.
Patients are created and read through the mdmbox FHIR proxy under
/fhir-server-api; the merge is the mdmbox /api/$merge operation.

Runs the flow end to end as a plain script:

  1. Create the target (survives) and source (duplicate) patients with one
     transaction Bundle POSTed to /fhir-server-api (PUT-upsert by id).
  2. POST mdmbox $merge. The plan PUTs the source with active:false + a
     "replaced-by" link to the target -- the duplicate is retired, not
     deleted, so it stays queryable for audit/history.
  3. GET the target back (the survivor, data from both patients).
  4. GET the source back (active:false, "replaced-by" link to the target).

Fresh patient ids are generated on every run (override with TARGET_ID /
SOURCE_ID). If any step fails the script stops and exits with status 1.

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


MDMBOX_URL = trim_slash(os.environ.get("MDMBOX_URL", "http://localhost:3003"))
PUBLIC_MDMBOX_URL = trim_slash(os.environ.get("PUBLIC_MDMBOX_URL", "http://localhost:3003"))
MDMBOX_AUTH = os.environ.get("MDMBOX_AUTH", "Basic cm9vdDpyb290")  # root:root

# The mdmbox FHIR proxy prefix. Patients are created (transaction Bundle) and
# read (GET) through here.
FHIR_PROXY = "/fhir-server-api"

# The mdmbox $merge operation (mounted under /api/fhir).
MERGE_PATH = "/api/fhir/$merge"

# The target survives the merge, the source is deactivated. Fresh ids are
# generated on every run so re-running never hits "already merged" -- set
# TARGET_ID / SOURCE_ID to override with fixed ids.
_RUN = uuid.uuid4().hex[:8]
TARGET_ID = os.environ.get("TARGET_ID", "target-" + _RUN)
SOURCE_ID = os.environ.get("SOURCE_ID", "source-" + _RUN)


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

    mdmbox returns 302 -> "/" when it is not activated / needs login; following
    it would replay the request against "/" in a loop. Surface it instead.
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
                        + "Activate mdmbox at "
                        + PUBLIC_MDMBOX_URL
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
    """Call any mdmbox endpoint (e.g. /api/$merge)."""
    return json_request(
        MDMBOX_URL + (path if path.startswith("/") else "/" + path),
        method=method,
        auth=MDMBOX_AUTH,
        body=body,
    )


# Patients are created and read through the mdmbox FHIR proxy under
# /fhir-server-api -- the script never talks to Aidbox directly.
def fhir_proxy(path, method="GET", body=None):
    return mdmbox(FHIR_PROXY + "/" + path.lstrip("/"), method=method, body=body)


# ---------------------------------------------------------------------------
# Sample patients
# ---------------------------------------------------------------------------
def target_patient():
    return {
        "resourceType": "Patient",
        "id": TARGET_ID,
        "active": True,
        "identifier": [{"system": "https://example.org/mrn", "value": "MRN-1000"}],
        "name": [{"use": "official", "given": ["Jane"], "family": "Doe"}],
        "birthDate": "1985-04-12",
        "gender": "female",
        "telecom": [{"system": "email", "value": "jane.doe@example.org", "use": "home"}],
        "address": [{"city": "Boston", "state": "MA", "country": "US"}],
    }


def source_patient():
    return {
        "resourceType": "Patient",
        "id": SOURCE_ID,
        "active": True,
        "identifier": [{"system": "https://example.org/mrn", "value": "MRN-2000"}],
        "name": [{"use": "official", "given": ["Jane"], "family": "Doe"}],
        "birthDate": "1985-04-12",
        "gender": "female",
        "telecom": [{"system": "phone", "value": "+1-555-0101", "use": "mobile"}],
        "address": [{"city": "Boston", "state": "MA", "country": "US"}],
    }


# Step 1 & 2: create patients via a transaction Bundle POSTed to the mdmbox
# FHIR proxy. Each entry is a PUT (upsert by id), so re-running is idempotent.
def transaction_bundle(patients):
    return {
        "resourceType": "Bundle",
        "type": "transaction",
        "entry": [
            {
                "request": {"method": "PUT",
                            "url": "/Patient/" + required_id(p, "patient")},
                "resource": p,
            }
            for p in patients
        ],
    }


def create_patients(patients):
    body = transaction_bundle(patients)
    result = fhir_proxy("", method="POST", body=body)
    return {
        "ok": result["ok"],
        "status": result["status"],
        "request": {"method": "POST", "url": FHIR_PROXY, "body": body},
        "response": result["body"],
    }


# Step 4 / Step 5: read a patient back through the mdmbox FHIR proxy.
def get_patient(pid):
    result = fhir_proxy("Patient/" + urllib.parse.quote(pid, safe=""))
    return {
        "ok": result["ok"],
        "status": result["status"],
        "request": {"method": "GET", "url": FHIR_PROXY + "/Patient/" + pid},
        "response": result["body"],
    }


# ---------------------------------------------------------------------------
# Merge plan: deactivate the source (active:false + replaced-by), don't delete
# ---------------------------------------------------------------------------
def with_patient_link(resource, link_type, other_id):
    """Add a Patient.link (idempotent) of the given type pointing at other_id."""
    nxt = deep_clone(resource)
    link = {"other": {"reference": "Patient/" + other_id}, "type": link_type}
    links = nxt["link"] if isinstance(nxt.get("link"), list) else []
    already = any(
        isinstance(l, dict)
        and l.get("type") == link_type
        and isinstance(l.get("other"), dict)
        and l["other"].get("reference") == "Patient/" + other_id
        for l in links
    )
    nxt["link"] = links if already else links + [link]
    return nxt


def deactivate_source(source, target_id):
    # The retired source: active:false + "replaced-by" -> the surviving target.
    nxt = with_patient_link(source, "replaced-by", target_id)
    nxt["active"] = False
    return nxt


def build_merge_plan(source, target):
    source_id = required_id(source, "source patient")
    target_id = required_id(target, "target patient")
    # Surviving target gets a "replaces" link back to the retired source -- the
    # canonical reciprocal of the source's "replaced-by" link.
    merged_target = with_patient_link(
        merge_resource_prefer_target(source, target), "replaces", source_id
    )
    deactivated_source = deactivate_source(source, target_id)

    target_put = {
        "resource": merged_target,
        "request": {"method": "PUT", "url": "Patient/" + target_id},
    }
    target_etag = etag(target)
    if target_etag:
        target_put["request"]["ifMatch"] = target_etag

    # Instead of DELETE: PUT the source back with active:false + replaced-by link.
    source_put = {
        "resource": deactivated_source,
        "request": {"method": "PUT", "url": "Patient/" + source_id},
    }
    source_etag = etag(source)
    if source_etag:
        source_put["request"]["ifMatch"] = source_etag

    return {
        "source": "Patient/" + source_id,
        "target": "Patient/" + target_id,
        "entries": [target_put, source_put],
        "mergedTarget": merged_target,
        "deactivatedSource": deactivated_source,
    }


def build_merge_parameters(source, target, entries, preview):
    return {
        "resourceType": "Parameters",
        "parameter": [
            {"name": "source", "valueReference": {"reference": source}},
            {"name": "target", "valueReference": {"reference": target}},
            {"name": "preview", "valueBoolean": preview},
            {"name": "plan", "resource": {
                "resourceType": "Bundle", "type": "transaction", "entry": entries}},
        ],
    }


# Step 3: mdmbox $merge.
def run_merge(source_id, target_id):
    source_id = str(source_id or SOURCE_ID).strip()
    target_id = str(target_id or TARGET_ID).strip()
    if not source_id or not target_id:
        return {"ok": False, "status": 400,
                "error": "Both source and target Patient ids are required."}

    source_read = fhir_proxy("Patient/" + urllib.parse.quote(source_id, safe=""))
    if not source_read["ok"]:
        return {"ok": False, "status": source_read["status"],
                "error": "Source Patient/{} not found".format(source_id),
                "response": source_read["body"]}
    target_read = fhir_proxy("Patient/" + urllib.parse.quote(target_id, safe=""))
    if not target_read["ok"]:
        return {"ok": False, "status": target_read["status"],
                "error": "Target Patient/{} not found".format(target_id),
                "response": target_read["body"]}

    plan = build_merge_plan(source_read["body"], target_read["body"])
    body = build_merge_parameters(plan["source"], plan["target"], plan["entries"], False)

    url = MDMBOX_URL + MERGE_PATH
    started = time.perf_counter()
    result = mdmbox(MERGE_PATH, method="POST", body=body)
    elapsed_ms = round((time.perf_counter() - started) * 1000)

    return {
        "ok": result["ok"],
        "status": result["status"],
        "via": url,
        "elapsedMs": elapsed_ms,
        "request": {"method": "POST", "url": MERGE_PATH, "body": body},
        "response": result["body"],
    }


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
# Generic helpers
# ---------------------------------------------------------------------------
def required_id(resource, label):
    pid = str((resource or {}).get("id") or "").strip()
    if not pid:
        raise ValueError(label + " must have id")
    return pid


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

    mdmbox can return HTTP 200 with an error-severity OperationOutcome (e.g.
    "source Patient/2 is already merged" on a re-run), so an HTTP 200 alone is
    not enough to call a step successful.
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
    else:
        mark = color("HTTP {}".format(status if status is not None else "error"),
                     _RED, _BOLD)
    print("\n" + "=" * 72)
    print("Step {}: {}  [{}]".format(num, title, mark))
    print("-" * 72)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return ok


def step(num, title, result):
    """Print a step; abort the run (SystemExit 1) if it failed."""
    if not print_step(num, title, result):
        print("\n" + color("Step {} failed -- aborting.".format(num), _RED, _BOLD))
        raise SystemExit(1)


def main():
    print("mdmbox merge-without-deletion example (standalone)")
    print("mdmbox: {}".format(MDMBOX_URL))
    print("  create/read patients: {}{}".format(MDMBOX_URL, FHIR_PROXY))
    print("  merge:                {}{}".format(MDMBOX_URL, MERGE_PATH))
    print("target Patient/{} survives, source Patient/{} is deactivated"
          .format(TARGET_ID, SOURCE_ID))

    # Step 1: create both patients in one transaction Bundle.
    step(
        1,
        "POST {} (transaction Bundle: Patient/{} + Patient/{})".format(
            FHIR_PROXY, TARGET_ID, SOURCE_ID),
        create_patients([target_patient(), source_patient()]),
    )

    # Step 2: POST $merge.
    step(2, "POST $merge", run_merge(SOURCE_ID, TARGET_ID))

    # Step 3: GET target back (merge result).
    step(3, "GET Patient/{} (merge result)".format(TARGET_ID),
         get_patient(TARGET_ID))

    # Step 4: GET source back (active: false).
    step(4, "GET Patient/{} (active: false)".format(SOURCE_ID),
         get_patient(SOURCE_ID))

    print("\n" + color("All steps completed.", _GREEN, _BOLD))


if __name__ == "__main__":
    main()
