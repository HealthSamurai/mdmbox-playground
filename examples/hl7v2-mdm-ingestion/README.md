# HL7v2 ingestion with MDM

Ingest HL7v2 messages through Interbox, match patients with MDMbox, and store source records and identity clusters in Aidbox. A patient portal and Grafana dashboard show the results.

## Run

Requires Docker Compose v2, Bun, and valid Aidbox, MDMbox and Interbox licenses. This example uses a separate local stack with its own database and ports.

```bash
cd examples/hl7v2-mdm-ingestion
cp .env.example .env
# Set AIDBOX_LICENSE, MDMBOX_LICENSE and INTERBOX_LICENSE in .env.
./showcase up
./showcase seed 100
./showcase verify
```

The seed sends synthetic patient records, diagnoses and A08 updates. On an empty stack, it produces 100 source patients grouped into 30 clusters and 10 singletons. Select a patient row to inspect source records and diagnoses. The Duplicates column counts extra source condition records (Conditions − Unique).

| Service | URL |
| --- | --- |
| Patient portal | http://localhost:8090 |
| Grafana | http://localhost:3002/d/mdm-real-world |
| Interbox | http://localhost:3011 |
| Aidbox | http://localhost:8890 |
| MDMbox | http://localhost:3005/admin |
| HL7v2 MLLP | localhost:2576 |

Services bind to localhost and use example credentials. MDMbox and Interbox authentication is disabled. Image versions are pinned in `.env.example`; Interbox uses an official main build pinned by digest.

## How it works

```text
HL7v2 → Interbox → MDM adapter → Aidbox → Patient portal
                       ↕          ↓
                    MDMbox    ClickHouse → Grafana
```

1. Interbox maps each message to a command Task and delivers it through its built-in `aidboxSender`.
2. The adapter calls MDMbox Patient `$match`, chooses cluster membership and calculates a golden view. Conditions are grouped by code system, code and onset within each patient cluster.
3. One Aidbox transaction writes the source records, Linkages, contained golden view and receipt. Version checks protect concurrent writes; receipts make repeated delivery idempotent. The adapter acknowledges only after commit.
4. Aidbox topics deliver resource changes to ClickHouse. Grafana reads the resulting current-state views. `verify` checks agreement between Aidbox, the portal and analytics.

The adapter owns the matching policy and commits directly to Aidbox. It does not call MDMbox `$link`. Patient source records remain separate; A08 updates preserve existing cluster membership and refresh the golden view.

`MSH-10` must be globally unique and immutable. Finish creates before sending updates for the same patients. All clinical writes must use the adapter; direct edits and other MDM workflows do not participate in its concurrency protocol. Ambiguous matches require review. The portal loads the dataset into memory and is intended for small examples.

## Replay and cleanup

Reuse a batch ID and count to test delivery without duplicate records:

```bash
SHOWCASE_SEED_BATCH=example ./showcase seed 100
SHOWCASE_SEED_BATCH=example ./showcase seed 100
./showcase verify
```

`up` preserves data. `clear` deletes this example's operational data; `down` stops the services; `reset` also deletes its volumes. Use `./showcase status` and `./showcase logs [service]` to inspect the stack.

## Checks

`./showcase check` runs local tests, type checks and lint; portal checks also require Node.js 22.13+ and npm. With the stack running, `check-analytics` tests ClickHouse snapshots. `verify-protocol`, `verify-adapter` and `verify-delivery` check concurrency, retries and analytics delivery; run them with ingestion idle. The first two add synthetic records, and the last briefly stops ingestion. See `./showcase --help` for all commands.
