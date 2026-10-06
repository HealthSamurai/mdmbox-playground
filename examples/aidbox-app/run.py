#!/usr/bin/env python3
"""mdmbox as an Aidbox App -- run MDM operations THROUGH Aidbox and restrict
them with Aidbox AccessPolicy.

The script registers an Aidbox App whose http-rpc endpoint points at mdmbox's
built-in aidbox-app-proxy, then calls the operations through Aidbox as two API
clients with different permissions:

  mdm-operator  may run $match for Patient
  mdm-steward   may run $match for Patient and $merge Patient records

Runs the flow end to end as a plain script:

  1. PUT /App/<id> into Aidbox -- registers an App declaring
     POST /fhir/<type>/$match and POST /fhir/$merge/v2, delivered over
     http-rpc to mdmbox.
  2. PUT the two Clients and their AccessPolicies into Aidbox.
  3-7. Call the operations as each client. Allowed calls reach mdmbox; denied
     calls get HTTP 403 from Aidbox and never reach mdmbox. $merge always runs
     with preview=true, so no data changes.

Flow when an allowed operation runs (this script is NOT in that path -- it only
registers the App and kicks off the request):

  script ──POST /fhir/Patient/$match──▶ Aidbox  (checks AccessPolicy)
  Aidbox ──http-rpc──▶ mdmbox /api/aidbox-app-proxy   (returns Bundle)
  Aidbox ──Bundle──▶ script

If any step does not end as expected the script stops and exits with status 1.

Only the Python standard library is used.
"""

import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request


def trim_slash(s: str) -> str:
    return s.rstrip("/")


# Aidbox -- admin client used to register the App, Clients and AccessPolicies,
# and the FHIR base the script invokes operations against.
AIDBOX_URL = trim_slash(os.environ.get("AIDBOX_URL", "http://localhost:8888"))
AIDBOX_AUTH = os.environ.get("AIDBOX_AUTH", "Basic cm9vdDpyb290")  # root:root

# mdmbox -- where the actual probabilistic matching lives. Aidbox reaches it via
# the App proxy, so this script never calls it directly (shown for context).
MDMBOX_URL = trim_slash(os.environ.get("MDMBOX_URL", "http://localhost:3003"))

# The MatchingModel installed in mdmbox to use for $match.
MODEL_ID = os.environ.get("MODEL_ID", "patient-example")

# Max candidate matches to request (same default as the example-app).
MATCH_RESULT_LIMIT = 100

# The endpoint Aidbox calls (over http-rpc) when an operation is invoked. Points
# at mdmbox's built-in Aidbox-app proxy, so Aidbox forwards straight to mdmbox.
# This URL is resolved by the Aidbox *container*, not by this script or the host:
# both services share the `mdmbox-playground` docker network, so Aidbox reaches
# mdmbox directly by service name (mdmbox's in-container port is 3000, published
# to the host as 3003). Override with APP_ENDPOINT_URL if you run mdmbox outside
# the compose network (e.g. http://host.docker.internal:3003/... on the host).
APP_ENDPOINT_URL = os.environ.get(
    "APP_ENDPOINT_URL", "http://mdmbox:3000/api/aidbox-app-proxy")

APP_ID = os.environ.get("APP_ID", "mdmbox.match")
APP_SECRET = os.environ.get("APP_SECRET", "mdmbox-match-secret")

# Aidbox Operation ids of the App operations. AccessPolicies refer to them as
# operation.id, so they must not collide with other Aidbox operations.
MATCH_OPERATION = "mdmbox-match"
MERGE_OPERATION = "mdmbox-merge"

# Demo API clients. Each authenticates to Aidbox with HTTP Basic credentials.
OPERATOR = {"id": "mdm-operator", "secret": "mdm-operator-secret"}
STEWARD = {"id": "mdm-steward", "secret": "mdm-steward-secret"}


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


def basic_auth(client):
    token = base64.b64encode(
        (client["id"] + ":" + client["secret"]).encode("utf-8")).decode("ascii")
    return "Basic " + token


def aidbox(path, method="GET", body=None, auth=AIDBOX_AUTH):
    """Call Aidbox, by default with the admin client credentials."""
    return json_request(
        AIDBOX_URL + (path if path.startswith("/") else "/" + path),
        method=method,
        auth=auth,
        body=body,
    )


# ---------------------------------------------------------------------------
# Aidbox App manifest -- declares $match and $merge, delivered over http-rpc to
# mdmbox's aidbox-app-proxy. The proxy maps the operation `path` to /api/<path>:
#   ["fhir", {"name": "type"}, "$match"] -> /api/fhir/<type>/$match
#   ["fhir", "$merge", "v2"]             -> /api/fhir/$merge/v2
# The operation keys become Aidbox Operation ids (operation.id in policies).
# ---------------------------------------------------------------------------
def app_manifest():
    return {
        "resourceType": "App",
        "id": APP_ID,
        "apiVersion": 1,
        "type": "app",
        "endpoint": {
            "type": "http-rpc",
            "url": APP_ENDPOINT_URL,
            "secret": APP_SECRET,
        },
        "operations": {
            # Type-level $match for any resource type: POST /fhir/<type>/$match.
            # The route parameter `type` reaches policies as params.type.
            MATCH_OPERATION: {"method": "POST",
                              "path": ["fhir", {"name": "type"}, "$match"]},
            # Server-computed merge: POST /fhir/$merge/v2. The resource type is
            # in the body, in the source and target references.
            MERGE_OPERATION: {"method": "POST", "path": ["fhir", "$merge", "v2"]},
        },
    }


# Step 1: PUT /App/<id> into Aidbox.
def register_app():
    manifest = app_manifest()
    result = aidbox("/App/" + APP_ID, method="PUT", body=manifest)
    return {
        "ok": result["ok"],
        "status": result["status"],
        "request": {"method": "PUT", "url": "/App/" + APP_ID, "body": manifest},
        "response": result["body"],
    }


# ---------------------------------------------------------------------------
# Clients and AccessPolicies
# ---------------------------------------------------------------------------
def clients():
    return [
        {"resourceType": "Client", "id": client["id"], "secret": client["secret"],
         "grant_types": ["basic"]}
        for client in (OPERATOR, STEWARD)
    ]


def access_policies():
    """One policy per permission. A request is allowed when any policy linked to
    its client matches; otherwise Aidbox answers 403 without calling mdmbox."""
    return [
        {
            "resourceType": "AccessPolicy",
            "id": "mdm-match-patient",
            "description": "Operators and stewards may run $match for Patient",
            "engine": "matcho",
            "link": [{"resourceType": "Client", "id": OPERATOR["id"]},
                     {"resourceType": "Client", "id": STEWARD["id"]}],
            "matcho": {
                "operation": {"id": MATCH_OPERATION},
                "params": {"type": "Patient"},
            },
        },
        {
            "resourceType": "AccessPolicy",
            "id": "mdm-merge-patient",
            "description": "Stewards may merge Patient records",
            "engine": "matcho",
            "link": [{"resourceType": "Client", "id": STEWARD["id"]}],
            # The source must be a Patient. mdmbox rejects a target of a
            # different type, so the source type decides the merged type.
            "matcho": {
                "operation": {"id": MERGE_OPERATION},
                "resource": {
                    "parameter": {
                        "$contains": {
                            "name": "source",
                            "valueReference": {"reference": "#^Patient/"},
                        }
                    }
                },
            },
        },
    ]


# Step 2: PUT the Clients and AccessPolicies into Aidbox.
def register_access():
    resources = clients() + access_policies()
    results = []
    for resource in resources:
        path = "/" + resource["resourceType"] + "/" + resource["id"]
        result = aidbox(path, method="PUT", body=resource)
        results.append({"url": path, "status": result["status"],
                        "response": result["body"] if not result["ok"] else None})
    return {
        "ok": all(200 <= r["status"] < 300 for r in results),
        "status": max(r["status"] for r in results),
        "request": [{k: v for k, v in r.items() if k != "secret"} for r in resources],
        "response": results,
    }


# ---------------------------------------------------------------------------
# $match and $merge through Aidbox
# ---------------------------------------------------------------------------
def build_match_parameters(model_id=None, resource=None, threshold=None,
                           count=None, only_certain=None, only_single=None):
    """Build the FHIR Parameters body for a type-level $match. The resource to
    match against is carried inline as the `resource` parameter."""
    parameter = []
    if model_id is not None:
        parameter.append({"name": "modelId", "valueString": model_id})
    if resource is not None:
        parameter.append({"name": "resource", "resource": resource})
    if threshold is not None:
        parameter.append({"name": "threshold", "valueDecimal": threshold})
    if only_certain is not None:
        parameter.append({"name": "onlyCertainMatches", "valueBoolean": only_certain})
    if only_single is not None:
        parameter.append({"name": "onlySingleMatch", "valueBoolean": only_single})
    if count is not None:
        parameter.append({"name": "count", "valueInteger": count})
    return {"resourceType": "Parameters", "parameter": parameter}


def sample_patient():
    # Matches two patients from the imported sample set ("Rob Allen" and
    # "Robert Allen", near-duplicates of each other), so $match returns a pair
    # the steward can merge later in the run.
    return {
        "resourceType": "Patient",
        "name": [{"given": ["Robert"], "family": "Allen"}],
        "birthDate": "1971-06-24",
    }


def sample_practitioner():
    return {
        "resourceType": "Practitioner",
        "name": [{"given": ["Robert"], "family": "Allen"}],
    }


def run_match_through_aidbox(client, resource, model_id=None, count=MATCH_RESULT_LIMIT):
    resource_type = resource.get("resourceType", "Patient")
    parameters = build_match_parameters(
        model_id=model_id or MODEL_ID, resource=resource, count=count)

    path = "/fhir/" + resource_type + "/$match"
    started = time.perf_counter()
    result = aidbox(path, method="POST", body=parameters, auth=basic_auth(client))
    elapsed_ms = round((time.perf_counter() - started) * 1000)

    return {
        "ok": result["ok"],
        "status": result["status"],
        "client": client["id"],
        "via": AIDBOX_URL + path,
        "elapsedMs": elapsed_ms,
        "request": parameters,
        "response": result["body"],
    }


def build_merge_parameters(source, target):
    # preview=true returns the planned changes without executing them, so the
    # example can run repeatedly against the same data.
    return {
        "resourceType": "Parameters",
        "parameter": [
            {"name": "source", "valueReference": {"reference": source}},
            {"name": "target", "valueReference": {"reference": target}},
            {"name": "preview", "valueBoolean": True},
        ],
    }


def summarize_merge_response(body):
    """A merge preview returns the whole planned transaction; keep the outcome
    and the planned request lines only."""
    if not isinstance(body, dict) or body.get("resourceType") != "Parameters":
        return body
    summary = {}
    for p in body.get("parameter", []):
        resource = p.get("resource") or {}
        if p.get("name") == "outcome":
            summary["outcome"] = resource
        elif resource.get("resourceType") == "Bundle":
            summary[p.get("name")] = [
                "{} {}".format(e.get("request", {}).get("method"), e.get("request", {}).get("url"))
                for e in resource.get("entry", [])
            ]
    return summary


def run_merge_through_aidbox(client, source, target):
    parameters = build_merge_parameters(source, target)
    path = "/fhir/$merge/v2"
    result = aidbox(path, method="POST", body=parameters, auth=basic_auth(client))
    return {
        "ok": result["ok"],
        "status": result["status"],
        "client": client["id"],
        "via": AIDBOX_URL + path,
        "request": parameters,
        "response": summarize_merge_response(result["body"]),
    }


def matched_references(bundle):
    if not isinstance(bundle, dict):
        return []
    return ["{}/{}".format(e["resource"]["resourceType"], e["resource"]["id"])
            for e in bundle.get("entry") or []
            if isinstance(e.get("resource"), dict) and e["resource"].get("id")]


# ---------------------------------------------------------------------------
# Match result rendering
# ---------------------------------------------------------------------------
def grade_of(entry):
    resource = entry.get("resource") or {}
    ext = ((resource.get("meta") or {}).get("extension")
           or (entry.get("search") or {}).get("extension")
           or [])
    for e in ext:
        if isinstance(e, dict) and "match-grade" in (e.get("url") or ""):
            return e.get("valueCode", "")
    return ""


def print_match_table(bundle):
    if (not isinstance(bundle, dict)
            or bundle.get("resourceType") != "Bundle"
            or not isinstance(bundle.get("entry"), list)
            or not bundle["entry"]):
        print("  (no matches returned)")
        return
    header = "  {:>6}  {:<10}  {:<24}  {:<12}  {}".format(
        "Score", "Grade", "Name", "Birthdate", "Reference")
    print(header)
    print("  " + "-" * (len(header) - 2))
    for e in bundle["entry"]:
        r = e.get("resource") or {}
        name = (r.get("name") or [{}])[0]
        given = " ".join(name.get("given") or [])
        full = (given + " " + (name.get("family") or "")).strip() or "-"
        score = (e.get("search") or {}).get("score")
        score_s = "{:.2f}".format(score) if isinstance(score, (int, float)) else "-"
        grade = grade_of(e) or "-"
        print("  {:>6}  {:<10}  {:<24}  {:<12}  Patient/{}".format(
            score_s, grade, full[:24], r.get("birthDate") or "-", r.get("id") or "-"))


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


def print_step(num, title, result, expected_status=None):
    """Print a step. Without expected_status the step must succeed; with it the
    step must end with exactly that HTTP status (e.g. 403 for a denied call)."""
    status = result.get("status")
    err = outcome_error(result.get("response"))
    if expected_status is None:
        ok = bool(result.get("ok")) and err is None
    else:
        ok = status == expected_status
    if ok and expected_status is not None and not result.get("ok"):
        mark = color("HTTP {} as expected".format(status), _GREEN, _BOLD)
    elif ok:
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


def step(num, title, result, expected_status=None):
    """Print a step; abort the run (SystemExit 1) if it failed. Returns result."""
    if not print_step(num, title, result, expected_status):
        print("\n" + color("Step {} failed -- aborting.".format(num), _RED, _BOLD))
        raise SystemExit(1)
    return result


def main():
    print("mdmbox as an Aidbox App example")
    print("Aidbox: {}  (register App and access, invoke operations)".format(AIDBOX_URL))
    print("mdmbox: {}  (matching engine, reached via the App proxy)".format(MDMBOX_URL))
    print("App:    {}  ->  {}".format(APP_ID, APP_ENDPOINT_URL))
    print("model:  {}".format(MODEL_ID))

    # Step 1: register the Aidbox App.
    step(1, "PUT /App/{} (register the Aidbox App)".format(APP_ID), register_app())

    # Step 2: register the demo clients and what each of them may do.
    step(2, "PUT Clients and AccessPolicies", register_access())

    # Step 3: the operator may match Patients.
    match = step(3, "{} runs Patient $match (allowed)".format(OPERATOR["id"]),
                 run_match_through_aidbox(OPERATOR, sample_patient()))
    print("\nMatches (searchset):")
    print_match_table(match.get("response"))

    # Step 4: no policy allows $match for other resource types.
    step(4, "{} runs Practitioner $match (denied)".format(OPERATOR["id"]),
         run_match_through_aidbox(OPERATOR, sample_practitioner()),
         expected_status=403)

    references = matched_references(match.get("response"))
    if len(references) < 2:
        print("\n" + color("$match returned fewer than two Patients; import the "
                           "sample patients in mdmbox and retry.", _RED, _BOLD))
        raise SystemExit(1)
    source, target = references[0], references[1]

    # Step 5: the operator may not merge.
    step(5, "{} previews Patient $merge (denied)".format(OPERATOR["id"]),
         run_merge_through_aidbox(OPERATOR, source, target),
         expected_status=403)

    # Step 6: the steward may merge Patients.
    step(6, "{} previews Patient $merge (allowed)".format(STEWARD["id"]),
         run_merge_through_aidbox(STEWARD, source, target))

    # Step 7: ...but not other resource types.
    step(7, "{} previews Practitioner $merge (denied)".format(STEWARD["id"]),
         run_merge_through_aidbox(STEWARD, "Practitioner/source", "Practitioner/target"),
         expected_status=403)

    print("\n" + color("All steps completed.", _GREEN, _BOLD))


if __name__ == "__main__":
    main()
