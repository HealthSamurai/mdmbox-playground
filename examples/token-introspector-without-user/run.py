#!/usr/bin/env python3
"""Prove that MDMbox accepts a Keycloak JWT without an Aidbox User.

The script gets an RS256 service-account token from the example Keycloak realm,
configures an Aidbox TokenIntrospector with the realm's issuer and JWKS endpoint,
confirms that the token subject has no matching Aidbox User, and calls MDMbox.
Only the Python standard library is used.
"""

import base64
import http.client
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
KEYCLOAK_URL = trim_slash(os.environ.get("KEYCLOAK_URL", "http://localhost:8081"))
AIDBOX_AUTH = os.environ.get("AIDBOX_AUTH", "Basic cm9vdDpyb290")  # root:root

KEYCLOAK_REALM = "mdmbox-example"
KEYCLOAK_CLIENT_ID = "mdmbox-api"
KEYCLOAK_CLIENT_SECRET = "mdmbox-example-secret"
INTROSPECTOR_ID = "mdmbox-keycloak-" + uuid.uuid4().hex[:10]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(NoRedirect)


def request(base_url, path, method="GET", auth=None, body=None, form=None):
    headers = {"accept": "application/json"}
    data = None
    if auth:
        headers["authorization"] = auth
    if body is not None:
        headers["content-type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if form is not None:
        headers["content-type"] = "application/x-www-form-urlencoded"
        data = urllib.parse.urlencode(form).encode("utf-8")

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
    except (urllib.error.URLError, http.client.RemoteDisconnected) as error:
        reason = getattr(error, "reason", str(error))
        return 0, {"error": str(reason)}


def parse_json(text):
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return text


def jwt_claims(token):
    parts = token.split(".")
    if len(parts) != 3:
        fail("Keycloak returned a malformed access token")
    encoded_claims = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(encoded_claims))
    except (ValueError, json.JSONDecodeError) as error:
        fail("Could not decode Keycloak access-token claims: " + str(error))


def tamper_signature(token):
    header, claims, signature = token.split(".")
    replacement = "A" if signature[0] != "A" else "B"
    return ".".join((header, claims, replacement + signature[1:]))


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


def wait_for_keycloak(timeout_seconds=90):
    deadline = time.monotonic() + timeout_seconds
    last = (0, None)
    while time.monotonic() < deadline:
        last = request(
            KEYCLOAK_URL,
            "/realms/" + KEYCLOAK_REALM + "/protocol/openid-connect/token",
            method="POST",
            form={
                "grant_type": "client_credentials",
                "client_id": KEYCLOAK_CLIENT_ID,
                "client_secret": KEYCLOAK_CLIENT_SECRET,
            },
        )
        if last[0] == 200 and isinstance(last[1], dict) and last[1].get("access_token"):
            return last
        time.sleep(1)
    return last


def wait_for_mdmbox(token, timeout_seconds=30):
    deadline = time.monotonic() + timeout_seconds
    last = (0, None)
    while time.monotonic() < deadline:
        last = request(MDMBOX_URL, "/api/models", auth="Bearer " + token)
        if last[0] != 0:
            return last
        time.sleep(0.5)
    return last


def main():
    status, token_response = wait_for_keycloak()
    if status != 200:
        fail("Could not obtain a Keycloak access token", status, token_response)

    token = token_response["access_token"]
    claims = jwt_claims(token)
    issuer = claims.get("iss")
    subject = claims.get("sub")
    if not issuer or not subject:
        fail("Keycloak access token has no iss or sub claim")
    print_step(
        "1. Get an RS256 service-account token from Keycloak",
        status,
        {
            "expires_in": token_response.get("expires_in"),
            "iss": issuer,
            "sub": subject,
            "token_type": token_response.get("token_type"),
        },
    )

    introspector = {
        "resourceType": "TokenIntrospector",
        "id": INTROSPECTOR_ID,
        "type": "jwt",
        "jwt": {"iss": issuer},
        "jwks_uri": issuer + "/protocol/openid-connect/certs",
    }

    status, body = request(
        AIDBOX_URL,
        "/TokenIntrospector/" + urllib.parse.quote(INTROSPECTOR_ID, safe=""),
        method="PUT",
        auth=AIDBOX_AUTH,
        body=introspector,
    )
    print_step("2. Configure Aidbox with Keycloak's issuer and JWKS endpoint", status, body)
    if status not in (200, 201):
        fail("Could not create TokenIntrospector", status, body)

    try:
        status, body = request(
            AIDBOX_URL,
            "/User/" + urllib.parse.quote(subject, safe=""),
            auth=AIDBOX_AUTH,
        )
        print_step("3. Confirm that the Keycloak subject has no Aidbox User", status, body)
        if status not in (404, 410):
            fail("The Keycloak subject unexpectedly resolves to an Aidbox User", status, body)

        status, body = wait_for_mdmbox(token)
        print_step("4. Call MDMbox with the valid Keycloak JWT and no User", status, body)
        if status != 200:
            fail("MDMbox did not accept the Keycloak JWT", status, body)

        invalid_token = tamper_signature(token)
        status, body = request(
            MDMBOX_URL,
            "/api/models",
            auth="Bearer " + invalid_token,
        )
        print_step("5. Call MDMbox with a tampered JWT signature", status, body)
        if status != 401:
            fail("MDMbox did not reject the tampered JWT", status, body)

        print("\nSuccess: MDMbox trusted the Keycloak JWT without requiring User/" + subject)
    finally:
        status, body = request(
            AIDBOX_URL,
            "/TokenIntrospector/" + urllib.parse.quote(INTROSPECTOR_ID, safe=""),
            method="DELETE",
            auth=AIDBOX_AUTH,
        )
        print_step("6. Remove the temporary TokenIntrospector", status, body)


if __name__ == "__main__":
    main()
