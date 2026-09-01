# TokenIntrospector JWT Without an Aidbox User

This example demonstrates API authentication when Aidbox and MDMbox share a
database. MDMbox reads the same `TokenIntrospector` resources and accepts a JWT
that passes Aidbox validation without requiring the token's `sub` to resolve to
an Aidbox `User`.

MDMbox does not evaluate Aidbox `AccessPolicy`. Once authentication is enabled,
every successfully authenticated credential has the same access to protected
MDMbox API endpoints.

## Start Aidbox and MDMbox

From this directory, start the shared Aidbox and MDMbox stack with the local
override that enables MDMbox authentication:

```bash
docker compose -f ../docker-compose.yaml -f docker-compose.yaml up -d
```

Activate Aidbox at <http://localhost:8888> and MDMbox at
<http://localhost:3003> if the development licenses have not been activated yet.

## Run the Example

The driver uses only the Python standard library:

```bash
python3 run.py
```

It performs five steps:

1. creates a temporary HS256 `TokenIntrospector` through Aidbox;
2. confirms that the JWT subject has no corresponding `User`;
3. calls `GET /api/models` on MDMbox with a valid JWT and expects `200`;
4. repeats the call with a bad signature and expects `401`;
5. removes the temporary `TokenIntrospector`.

HS256 keeps the example self-contained. A Keycloak deployment normally uses
the same contract with an RS256 introspector and Keycloak's JWKS endpoint:

```json
{
  "resourceType": "TokenIntrospector",
  "id": "keycloak",
  "type": "jwt",
  "jwt": {
    "iss": "https://keycloak.example/realms/my-realm"
  },
  "jwks_uri": "https://keycloak.example/realms/my-realm/protocol/openid-connect/certs"
}
```

No `User/<sub>` resource or user synchronization is required for MDMbox API
authentication.

Stop the stack with:

```bash
docker compose -f ../docker-compose.yaml -f docker-compose.yaml down
```
