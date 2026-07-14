#!/usr/bin/env python3
"""mdmbox as an Aidbox App -- register + run $match THROUGH Aidbox.

This is the Aidbox-plugin flavour of the example, so the script deliberately
talks to Aidbox: it registers an Aidbox App whose http-rpc endpoint points at
mdmbox's built-in aidbox-app-proxy, then invokes $match through Aidbox (which
forwards it to mdmbox).

Runs the flow end to end as a plain script:

  1. PUT /App/<id> into Aidbox -- registers an App declaring POST Patient/$match,
     delivered over http-rpc to mdmbox.
  2. POST /fhir/Patient/$match through Aidbox -- Aidbox routes the operation to
     mdmbox, which runs the probabilistic match and returns a searchset Bundle
     (scores + match grades).

Flow when a match runs (this script is NOT in that path -- it only registers
the App and kicks off the request):

  script ──POST /fhir/Patient/$match──▶ Aidbox
  Aidbox ──http-rpc──▶ mdmbox /api/aidbox-app-proxy   (returns Bundle)
  Aidbox ──Bundle──▶ script

If any step fails the script stops and exits with status 1.

Only the Python standard library is used.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request


def trim_slash(s: str) -> str:
    return s.rstrip("/")


# Aidbox -- admin client used to register the App and the FHIR base the script
# invokes $match against.
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


def aidbox(path, method="GET", body=None):
    """Call Aidbox with the admin client credentials."""
    return json_request(
        AIDBOX_URL + (path if path.startswith("/") else "/" + path),
        method=method,
        auth=AIDBOX_AUTH,
        body=body,
    )


# ---------------------------------------------------------------------------
# Aidbox App manifest -- declares $match, delivered over http-rpc to mdmbox's
# aidbox-app-proxy. The proxy maps the operation `path` to /api/<path>:
#   ["fhir","Patient","$match"] -> /api/fhir/Patient/$match
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
            # Type-level $match: POST /fhir/Patient/$match.
            "patient-match": {"method": "POST", "path": ["fhir", "Patient", "$match"]},
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
# $match through Aidbox
# ---------------------------------------------------------------------------
def build_match_parameters(model_id=None, resource=None, threshold=None,
                           count=None, only_certain=None, only_single=None):
    """Build the FHIR Parameters body for a type-level $match. The Patient to
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
    # Matches a patient from the imported sample set (the "Robert Allen"
    # near-duplicate pair), so $match returns at least one result out of the box.
    return {
        "resourceType": "Patient",
        "name": [{"given": ["Robert"], "family": "Allen"}],
        "birthDate": "1971-05-24",
    }


# Step 2: run type-level $match THROUGH Aidbox.
def run_match_through_aidbox(resource=None, model_id=None, count=MATCH_RESULT_LIMIT):
    resource = resource or sample_patient()
    resource_type = resource.get("resourceType", "Patient")
    parameters = build_match_parameters(
        model_id=model_id or MODEL_ID, resource=resource, count=count)

    path = "/fhir/" + resource_type + "/$match"
    started = time.perf_counter()
    result = aidbox(path, method="POST", body=parameters)
    elapsed_ms = round((time.perf_counter() - started) * 1000)

    return {
        "ok": result["ok"],
        "status": result["status"],
        "via": AIDBOX_URL + path,
        "elapsedMs": elapsed_ms,
        "request": parameters,
        "response": result["body"],
    }


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
    """Print a step; abort the run (SystemExit 1) if it failed. Returns result."""
    if not print_step(num, title, result):
        print("\n" + color("Step {} failed -- aborting.".format(num), _RED, _BOLD))
        raise SystemExit(1)
    return result


def main():
    print("mdmbox as an Aidbox App example")
    print("Aidbox: {}  (register App, invoke $match)".format(AIDBOX_URL))
    print("mdmbox: {}  (matching engine, reached via the App proxy)".format(MDMBOX_URL))
    print("App:    {}  ->  {}".format(APP_ID, APP_ENDPOINT_URL))
    print("model:  {}".format(MODEL_ID))

    # Step 1: register the Aidbox App.
    step(1, "PUT /App/{} (register the Aidbox App)".format(APP_ID), register_app())

    # Step 2: run $match through Aidbox and show the searchset.
    match = step(2, "POST /fhir/Patient/$match (through Aidbox)",
                 run_match_through_aidbox())
    print("\nMatches (searchset):")
    print_match_table(match.get("response"))

    print("\n" + color("All steps completed.", _GREEN, _BOLD))


if __name__ == "__main__":
    main()
