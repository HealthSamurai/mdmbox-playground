# Linkage

This example shows how to group duplicate records with MDMbox `$link` and how to
reverse it with `$unlink`. Unlike `$merge`, linkage is **non-destructive**: the
source records are never modified. Two `Patient` records are grouped under a
separate profiled `Linkage` resource; unlinking removes that Linkage and leaves
both sources exactly as they were.

## Set Up Aidbox and MDMbox

First of all, start Aidbox, MDMbox, and the notebook:

```bash
$ docker compose up
```

Once Aidbox is up and running, browse http://localhost:8888 and click
"Continue with Aidbox account". This will automatically issue a developer
license for you and redirect you back.

Then do the same with MDMbox. Open http://localhost:3003 and click
"Sign in to activate".

You'll see the [Welcome to MDMBox](http://localhost:3003/welcome)
page. Click your way through the setup steps to import sample patients
and install a matching model.

## Run the Linkage Flow

Open http://localhost:3300 and follow the instructions there. This is a notebook
that walks through the linkage lifecycle in five steps:

1. **POST `Patient/1`** — create the first source record.
2. **POST `Patient/2`** — create the second source record (same person).
3. **POST `$link`** — group both under one profiled `Linkage` carrying a golden view.
4. **GET `Linkage`** — read the created link back (sources untouched).
5. **POST `$unlink`** — reverse the link; the Linkage is removed.

## How it works

Patients are created and read through Aidbox's FHIR API. The `$link` and
`$unlink` calls go to MDMbox, which shares the same database.

`$link` is a **client-owned plan executor** — there is no source/target. The
request body is just `{ plan, preview }`, where the plan is a transaction Bundle
that creates a profiled `Linkage`:

```json
{
  "resourceType": "Linkage",
  "meta": {
    "profile": [
      "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage"
    ]
  },
  "active": true,
  "contained": [
    {
      "resourceType": "Patient",
      "id": "golden",
      "active": true,
      "identifier": [
        { "system": "https://example.org/mrn", "value": "MRN-1000" },
        { "system": "https://example.org/mrn", "value": "MRN-2000" }
      ],
      "name": [{ "use": "official", "given": ["Jane"], "family": "Doe" }],
      "birthDate": "1985-04-12",
      "gender": "female"
    }
  ],
  "item": [
    { "type": "source",    "resource": { "reference": "#golden" } },
    { "type": "alternate", "resource": { "reference": "Patient/1" } },
    { "type": "alternate", "resource": { "reference": "Patient/2" } }
  ]
}
```

The profile marks the Linkage as MDMbox-managed and defines the namespace for
the **one active Linkage per reference** rule — trying to link a reference that
already belongs to an active Linkage returns `409 Conflict`. MDMbox wraps the
plan with an audit `Task` (`code=link`) and `Provenance`, and executes it
atomically. Neither `Patient/1` nor `Patient/2` is written.

### Golden view in `contained`

The dedicated profile allows a single **golden (survivorship) view** to live
inside the Linkage's `contained`. It is named by the one `source` item as
`#golden`; the linked sources become `alternate` members. The contained golden:

- has a local `id` and is referenced as `#golden`;
- carries no `meta.versionId`, `meta.lastUpdated`, or `meta.security`.

MDMbox does not recalculate it — the client owns it and updates it in the same
plan when the cluster changes. This keeps the merged representation alongside the
link without ever rewriting the source records.

### Navigating from a source to its Linkage

The sources deliberately carry **no back-reference** to the Linkage. In FHIR the
`Linkage` resource is the one that points at its members (`Linkage.item`), and
there is no standard `Patient` element for the inverse — so keeping the sources
untouched is both non-destructive and FHIR-consistent. To go from a source
record to the link it belongs to, use a reverse search on the member reference:

```
GET Linkage?item=Patient/1
```

This is exactly what Step 4 does. Because the profile enforces **one active
Linkage per reference**, that search returns the single active cluster a source
currently belongs to — no stored pointer on the `Patient` is needed. (If you do
want a materialized relationship, `Patient.link` with `type: "seealso"` between
the duplicates, or a custom extension, would be added as a separate `PATCH`
entry in the same plan — but that rewrites the sources and is outside this
non-destructive example.)

`$unlink` reverses it. It takes the link audit `Task` plus a reverse plan —
here a single `DELETE` of the Linkage:

```json
{
  "resourceType": "Parameters",
  "parameter": [
    { "name": "task", "valueReference": { "reference": "Task/<link-task-id>" } },
    { "name": "preview", "valueBoolean": false },
    {
      "name": "plan",
      "resource": {
        "resourceType": "Bundle",
        "type": "transaction",
        "entry": [{ "request": { "method": "DELETE", "url": "Linkage/<id>" } }]
      }
    }
  ]
}
```

A profiled Linkage is fixed `active: true`, so it cannot be deactivated in
place — unlink removes it (its history stays queryable via `/_history`). The
original link `Task` is flipped `linked → unlinked`, and the references are free
to be linked again.

> **Note:** the notebook posts to `/api/fhir/$link` and `/api/fhir/$unlink`.
> If your MDMbox build mounts these operations elsewhere, adjust the paths in
> `notebook.ts`.
