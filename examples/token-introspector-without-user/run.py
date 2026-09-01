#!/usr/bin/env python3
"""Prove that MDMbox accepts a TokenIntrospector JWT without an Aidbox User.

The script creates a temporary shared TokenIntrospector through Aidbox, signs an
HS256 JWT whose sub has no matching User resource, calls MDMbox with that token,
checks that a token with the wrong signature is rejected, and removes the
TokenIntrospector again. Only the Python standard library is used.
"""

import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


def trim_slash(value):
    return value.rstrip("/")


AIDBOX_URL = trim_slash(os.environ.get("AIDBOX_URL", "http://localhost:8888"))
MDMBOX_URL = trim_slash(os.environ.get("MDMBOX_URL", "http://localhost:3003"))
AIDBOX_AUTH = os.environ.get("AIDBOX_AUTH", "Basic cm9vdDpyb290")  # root:root

RUN_ID = uuid.uuid4().hex[:10]
INTROSPECTOR_ID = "mdmbox-token-only-" + RUN_ID
ISSUER = "urn:mdmbox-example:token-only:" + RUN_ID
SUBJECT = "external-user-without-aidbox-user-" + RUN_ID
SECRET = "mdmbox-example-token-secret-" + RUN_ID


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(NoRedirect)


def request(base_url, path, method="GET", auth=None, body=None):
    headers = {"accept": "application/json"}
    data = None
    if auth:
        headers["authorization"] = auth
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(
        base_url + path, data=data, headers=headers, method=method
    )
    try:
        with HTTP.open(req) as response:
            text = response.read().decode("utf-8", "replace")
            return response.status, parse_json(text)
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", "replace")
        return error.code, parse_json(text)
    except urllib.error.URLError as error:
        return 0, {"error": str(error.reason)}


def parse_json(text):
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return text


def base64url(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=")


def sign_hs256(secret, claims):
    header = {"alg": "HS256", "typ": "JWT"}
    encoded_header = base64url(
        json.dumps(header, separators=(",", ":")).encode("utf-8")
    )
    encoded_claims = base64url(
        json.dumps(claims, separators=(",", ":")).encode("utf-8")
    )
    signing_input = encoded_header + b"." + encoded_claims
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return (signing_input + b"." + base64url(signature)).decode("ascii")


def print_step(label, status, body):
    print("\n" + label)
    print("HTTP", status)
    print(json.dumps(body, indent=2, sort_keys=True) if body is not None else "")


def fail(message, status=None, body=None):
    print("\nERROR:", message, file=sys.stderr)
    if status is not None:
        print("HTTP", status, file=sys.stderr)
    if body is not None:
        print(json.dumps(body, indent=2, sort_keys=True), file=sys.stderr)
    raise SystemExit(1)


def wait_for_mdmbox(token, timeout_seconds=15):
    deadline = time.monotonic() + timeout_seconds
    last = (0, None)
    while time.monotonic() < deadline:
        last = request(
            MDMBOX_URL,
            "/api/models",
            auth="Bearer " + token,
        )
        if last[0] == 200:
            return last
        time.sleep(0.5)
    return last


def main():
    introspector = {
        "resourceType": "TokenIntrospector",
        "id": INTROSPECTOR_ID,
        "type": "jwt",
        "jwt": {"iss": ISSUER, "secret": SECRET},
    }

    status, body = request(
        AIDBOX_URL,
        "/TokenIntrospector/" + urllib.parse.quote(INTROSPECTOR_ID, safe=""),
        method="PUT",
        auth=AIDBOX_AUTH,
        body=introspector,
    )
    print_step("1. Create the shared TokenIntrospector", status, body)
    if status not in (200, 201):
        fail("Could not create TokenIntrospector", status, body)

    try:
        status, body = request(
            AIDBOX_URL,
            "/User/" + urllib.parse.quote(SUBJECT, safe=""),
            auth=AIDBOX_AUTH,
        )
        print_step("2. Confirm that the JWT subject has no Aidbox User", status, body)
        if status not in (404, 410):
            fail("The example subject unexpectedly resolves to a User", status, body)

        now = int(time.time())
        claims = {
            "iss": ISSUER,
            "sub": SUBJECT,
            "iat": now,
            "exp": now + 300,
        }
        token = sign_hs256(SECRET, claims)
        status, body = wait_for_mdmbox(token)
        print_step("3. Call MDMbox with the valid JWT and no User", status, body)
        if status != 200:
            fail("MDMbox did not accept the TokenIntrospector JWT", status, body)

        invalid_token = sign_hs256("wrong-secret", claims)
        status, body = request(
            MDMBOX_URL,
            "/api/models",
            auth="Bearer " + invalid_token,
        )
        print_step("4. Call MDMbox with an invalid signature", status, body)
        if status != 401:
            fail("MDMbox did not reject the invalid JWT", status, body)

        print("\nSuccess: MDMbox trusted the valid JWT without requiring User/" + SUBJECT)
    finally:
        status, body = request(
            AIDBOX_URL,
            "/TokenIntrospector/" + urllib.parse.quote(INTROSPECTOR_ID, safe=""),
            method="DELETE",
            auth=AIDBOX_AUTH,
        )
        print_step("5. Remove the temporary TokenIntrospector", status, body)


if __name__ == "__main__":
    main()
