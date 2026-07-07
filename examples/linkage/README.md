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
3. **POST `$link`** — group both under one profiled `Linkage`.
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
  "item": [
    { "type": "source",    "resource": { "reference": "Patient/1" } },
    { "type": "alternate", "resource": { "reference": "Patient/2" } }
  ]
}
```

The profile marks the Linkage as MDMbox-managed and defines the namespace for
the **one active Linkage per reference** rule — trying to link a reference that
already belongs to an active Linkage returns `409 Conflict`. MDMbox wraps the
plan with an audit `Task` (`code=link`) and `Provenance`, and executes it
atomically. Neither `Patient/1` nor `Patient/2` is written.

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
