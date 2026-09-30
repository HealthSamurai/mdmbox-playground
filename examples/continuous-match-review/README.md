# Continuous Matching Review

A data steward app on top of MDMbox [continuous matching](https://www.health-samurai.io/docs/mdmbox/continuous-matching): a dashboard of the duplicate pairs that MDMbox keeps finding, and a review page to merge a pair attribute by attribute or mark it as not a match.

Built with TypeScript, React, Vite, and Tailwind CSS. Patient records are read from the adjacent Aidbox; matching results and decisions go to MDMbox.

## How to Start

The dashboard reads continuous matching results as JSON pages, which MDMbox serves starting with the `edge` image. From this directory, start the shared Aidbox and MDMbox stack with [docker-compose.yaml](docker-compose.yaml), which switches MDMbox to `edge`:

```bash
docker compose -f ../docker-compose.yaml -f docker-compose.yaml up
```

If you have Aidbox and MDMbox license JWTs, put them into `../.env` next to `../docker-compose.yaml` (Compose reads `.env` from the directory of the first file), and the services start licensed:

```dotenv
AIDBOX_LICENSE=<Aidbox license JWT>
MDMBOX_LICENSE=<MDMbox license JWT>
```

Otherwise, activate both licenses as described in the [examples README](../README.md): open http://localhost:8888 and click "Continue with Aidbox account", then open http://localhost:3003 and click "Sign in to activate". Until then, Aidbox and MDMbox redirect API requests to their start pages. After activating MDMbox in the browser, restart it once (`docker compose -f ../docker-compose.yaml -f docker-compose.yaml restart mdmbox`): until MDMbox restarts, merges fail with HTTP 500.

Then run from this directory:

```bash
cp .env.example .env
bun install
bun run setup
bun dev
```

The app is available at http://localhost:3007.

`bun run setup` loads the sample patients of the MDMbox welcome page if Aidbox has none, saves the example [BulkMatchingModel](bulk-matching-model.json) in Aidbox, and starts continuous matching for it. For the 1,000 sample patients this takes a few seconds. You can also start the process from the dashboard, or in MDMbox Admin under **Matching → Continuous matching**.

Backend URLs and credentials are read from `.env` (see [.env.example](.env.example)). The Vite dev server proxies `/api` to MDMbox and `/fhir` to Aidbox and adds the `Authorization` header, so credentials never reach the browser.

| Script | Description |
| --- | --- |
| `bun run setup` | Install the example model and start continuous matching |
| `bun dev` | Start the Vite dev server (port 3007) |
| `bun run build` | Type-check and build the production bundle into `dist/` |
| `bun test` | Run the unit tests |

## Dashboard

- **Process**: status of the continuous matching process, the model version it runs, records waiting for a batch, and errors. Polled every 5 seconds.
- **Pairs by decision**: pairs to review, merged, and not a match. Each tile filters the queue.
- **Queue**: pairs strongest first, one page at a time, with both records and the features that raised or lowered the match weight. When continuous matching finds new pairs, the queue offers to refresh.

A page of the queue is one request:

```http
GET /api/continuous-match/patient-continuous/result?decisionStatus=pending&_count=20&_page=0
Accept: application/json
```

```json
{
  "entries": [
    {
      "resourceId1": "101",
      "resourceId2": "105",
      "matchWeight": 40.0,
      "matchDetails": { "given": 8.0, "family": 9.0, "birth_date": 10.0, "email": 10.0, "city": 3.0 },
      "decisionStatus": "pending"
    }
  ],
  "total": 1137
}
```

`_count` is the page size (100 by default, up to 1,000) and `_page` is zero-based; the app numbers pages from 1. Pairs come strongest first, and pairs of equal weight are ordered by resource ids. `total` counts the pairs that match `decisionStatus` on all pages, and `_count=0` returns only the total: that is how the dashboard counts pairs per decision. Every request reads the live results, so pairs move between pages as MDMbox finds new ones and decisions are made. Without `Accept: application/json`, the endpoint exports all pairs as NDJSON or CSV.

The records of a page come from one Aidbox search: `GET /fhir/Patient?_id=<ids>`.

MDMbox evaluates `decisionStatus` at request time from merge and not-a-match Tasks, so the app stores nothing: a decided pair leaves the queue immediately.

## Pair Review

Click a pair to compare the two records side by side:

- **Surviving record**: keeps its id and receives the references of the other record, which is deleted.
- **Attributes**: for each attribute that differs, pick the value to keep. By default the more complete record survives, and its empty attributes are filled from the other record. The radio buttons in the header take everything from one record.
- **Identifiers**: the surviving record keeps the identifiers of both records.

**Merge…** calls [`$merge/v2`](https://www.health-samurai.io/docs/mdmbox/merge-operation) with `preview=true` and shows the planned changes. Confirming sends the same request with `preview=false`:

```json
{
  "resourceType": "Parameters",
  "parameter": [
    { "name": "source", "valueReference": { "reference": "Patient/380" } },
    { "name": "target", "valueReference": { "reference": "Patient/378" } },
    { "name": "result", "resource": { "resourceType": "Patient", "id": "378", "birthDate": "1993-02-08" } },
    { "name": "related-resource-type", "valueString": "Encounter" },
    { "name": "preview", "valueBoolean": false }
  ]
}
```

`result` is the complete surviving record with the selected attributes. MDMbox's built-in `simple` algorithm writes it to the target, moves references from the listed related resource types (see `RELATED_RESOURCE_TYPES` in [src/api/mdmbox.ts](src/api/mdmbox.ts)), and deletes the source. The merge Task lets you undo the merge with `$unmerge/v2`.

**Not a match** calls [`$mark-not-a-match`](https://www.health-samurai.io/docs/mdmbox/mark-not-a-match) with an optional note. MDMbox then refuses to link or merge the pair.

## Watch Continuous Matching

Continuous matching picks up inserted records within seconds. Create a near duplicate of a sample patient:

```bash
curl -u root:root -H 'Content-Type: application/json' http://localhost:8888/fhir/Patient \
  -d '{"resourceType": "Patient", "name": [{"given": ["Robert"], "family": "Alan"}], "birthDate": "1971-06-24", "telecom": [{"system": "email", "value": "robert255@smith.net"}]}'
```

The dashboard announces the new pairs; click **Refresh** to load them.

Continuous matching captures inserts only. After a merge, pending pairs with the deleted record stay in the results. The review page shows the last version of the deleted record and links to the pair with the record it was merged into.

## Model

[bulk-matching-model.json](bulk-matching-model.json) compares first name, last name, birth date, email, and city, the fields of the sample patients. A feature adds nothing when either record lacks the value. Pairs from weight 8 (`probable`) are kept; from 30 (`certain`) they are marked as certain.
