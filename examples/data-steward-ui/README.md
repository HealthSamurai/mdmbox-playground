# MDMbox Data Steward UI Example

An example frontend app that demonstrates what a data steward UI may look like with MDMbox.

Built with TypeScript, React, Vite, and Tailwind CSS.

FHIR reads and searches go to the adjacent Aidbox instance. Matching, merge,
and history operations go to MDMbox, which shares the Aidbox database.

## How to Start

Make sure Aidbox and MDMbox are running by running `docker compose up` in the
parent directory. Then run the following:

```bash
$ bun install

$ bun dev
```

The app is available at http://localhost:3002

## Features

- **Patient search** — search, filter, and paginate patients via FHIR search
- **Duplicate matching** — find potential duplicates using MDMbox matching models with configurable thresholds
- **Record merging** — side-by-side field comparison, reference relinking, merge preview and execution
- **Merge history** — browse and inspect past merge operations with provenance details

## Scripts

| Script | Description |
|---|---|
| `bun run dev` | Start Vite dev server (port 3002) |
| `bun run typegen` | Regenerate FHIR R4 type definitions |
