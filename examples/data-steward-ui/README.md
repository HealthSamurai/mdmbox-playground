# MDMbox Data Steward UI Example

An example frontend app that demonstrates what a data steward UI may look like with MDMbox.

Built with TypeScript, React, Vite, and Tailwind CSS.

FHIR reads and searches go to the adjacent Aidbox instance. Matching, merge, and history operations go to MDMbox, which shares the Aidbox database.

## How to Start

Make sure Aidbox and MDMbox are running by running `docker compose up` in the parent directory. Then run the following:

```bash
$ cp .env.example .env

$ bun install

$ bun dev
```

The app is available at http://localhost:3002

Backend URLs and credentials are read from `.env` (see [.env.example](.env.example)); its defaults match the shared docker-compose stack. Without a `.env` the dev proxy sends no `Authorization` header and FHIR requests fail with `401`. Set `MDMBOX_AUTH` when MDMbox runs with authentication enabled.

## Features

- **Patient search** — search, filter, and paginate patients via FHIR search
- **Duplicate matching** — find potential duplicates using MDMbox matching models with configurable thresholds
- **Record merging** — side-by-side field comparison, reference relinking, merge preview and execution
- **Merge history** — browse and inspect past merge operations with provenance details
- **Unmerge** — reverse a past merge from its detail page with a preview of the restore plan, and browse past unmerge operations

## Scripts

| Script | Description |
| --- | --- |
| `bun run dev` | Start Vite dev server (port 3002) |
| `bun run build` | Type-check and build the production bundle into `dist/` |
| `bun run serve` | Serve the built app with the production Bun server ([server/index.ts](server/index.ts)) |
| `bun run typegen` | Regenerate FHIR R4 type definitions |
