# Keycloak JWT Without an Aidbox User

This example runs Keycloak, obtains an RS256 access token, and configures an Aidbox `TokenIntrospector` with the Keycloak realm's issuer and JWKS endpoint. MDMbox accepts the token even though its `sub` does not resolve to an Aidbox `User`.

The example intentionally does not set `BOX_SECURITY_INTROSPECTION_CREATE_USER`. No user synchronization is required for MDMbox API authentication.

MDMbox does not evaluate Aidbox `AccessPolicy`. Once authentication is enabled, every successfully authenticated credential has the same access to protected MDMbox API endpoints.

## Start the Example Stack

From this directory, start Aidbox, MDMbox, and the preconfigured Keycloak realm:

```bash
docker compose -f ../docker-compose.yaml -f docker-compose.yaml up -d
```

The example uses these local endpoints:

- Keycloak: <http://localhost:8081>
- Aidbox: <http://localhost:8888>
- MDMbox: <http://localhost:3003>

Activate Aidbox and MDMbox on the first start if their development licenses have not been activated yet. API calls return `302` until activation is complete. MDMbox stores the issued license in the database and reuses it when the container is recreated.

## Run the Example

The driver uses only the Python standard library:

```bash
python3 run.py
```

It performs six steps:

1. obtains an RS256 service-account token from Keycloak;
2. creates a temporary `TokenIntrospector` using the token's `iss` and the realm's JWKS endpoint;
3. confirms that the JWT subject has no corresponding Aidbox `User`;
4. calls `GET /api/models` on MDMbox with the valid JWT and expects `200`;
5. tampers with the JWT signature and expects MDMbox to return `401`;
6. removes the temporary `TokenIntrospector`.

The Keycloak realm and confidential client are declared in [`keycloak-realm.json`](keycloak-realm.json). The container imports that realm on startup, so no manual Keycloak configuration is needed.

Stop the stack with:

```bash
docker compose -f ../docker-compose.yaml -f docker-compose.yaml down
```

To go back to the regular stack with MDMbox authentication disabled, run `docker compose up -d` from the parent `examples` directory.
