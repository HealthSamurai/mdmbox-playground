# Merge Without Deletion

This example shows how to run an MDMbox `$merge` that does not delete the
source record. Instead of removing the duplicate, the merge plan PUTs it back
with `active: false` and a `replaced-by` link to the surviving target, so the
retired record stays queryable for audit and history.

## Set Up MDMbox

Start MDMbox from the `standalone-examples` directory (see the
[parent README](../README.md)):

```bash
$ docker compose up
```

Once MDMbox is up, browse http://localhost:3003 and click "Sign in to
activate" — this issues a developer license automatically. Then walk through
the [Welcome to MDMbox](http://localhost:3003/welcome) setup steps to install a
matching model.

## Run the Merge Flow

The example is a plain Python script (standard library only — no dependencies):

```bash
$ python3 run.py
```

It prints each step and its request/response. The flow runs in four steps:

1. **POST `/fhir-server-api`** — create the target (the survivor) and the
   source (the duplicate) with one transaction Bundle.
2. **POST `$merge`** — merge the source into the target; the source is kept
   inactive instead of deleted.
3. **GET the target** — read back the merged survivor.
4. **GET the source** — read back the retired source.

## How it works

The script first creates the two patients by POSTing a FHIR **transaction
Bundle** to the MDMbox FHIR proxy at `/fhir-server-api`.

```json
{
  "resourceType": "Bundle",
  "type": "transaction",
  "entry": [
    { "request": { "method": "PUT", "url": "/Patient/1" }, "resource": { "resourceType": "Patient", "id": "1", "...": "..." } },
    { "request": { "method": "PUT", "url": "/Patient/2" }, "resource": { "resourceType": "Patient", "id": "2", "...": "..." } }
  ]
}
```

Then it sends a `$merge` request to MDMbox (`/api/fhir/$merge`). `$merge`
executes the transaction Bundle that the client sends, so deleting vs.
deactivating is purely what the plan contains. This example builds two `PUT`
entries (no `DELETE`).

The first entry is the **surviving target** (target wins scalar conflicts,
arrays are union-merged, missing target fields are filled from the source), plus
a `replaces` link back to the source:

```json
{
  "resource": {
    "resourceType": "Patient",
    "id": "1",
    "link": [
      { "type": "replaces", "other": { "reference": "Patient/2" } }
    ]
  },
  "request": { "method": "PUT", "url": "Patient/1" }
}
```

The second entry is the **source**, PUT back with `active: false` and a
`replaced-by` link to the target (the reciprocal of the target's `replaces`):

```json
{
  "resource": {
    "resourceType": "Patient",
    "id": "2",
    "active": false,
    "link": [
      { "type": "replaced-by", "other": { "reference": "Patient/1" } }
    ]
  },
  "request": { "method": "PUT", "url": "Patient/2" }
}
```
