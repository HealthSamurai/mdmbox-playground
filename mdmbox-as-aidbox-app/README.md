# mdmbox as an Aidbox App

A single-page **notebook** (served by Bun, styled like mdmbox's `/welcome`) that:

1. **Registers an Aidbox App** which declares a `POST Patient/$match` operation.
2. **Runs `$match` through Aidbox** — Aidbox routes the operation, over http-rpc,
   back to this Bun server, which proxies it into mdmbox's probabilistic `$match`
   and returns the FHIR searchset Bundle.

## Flow

```
browser ──POST /fhir/Patient/$match──▶ Aidbox
Aidbox  ──http-rpc {type:"operation"}─▶ notebook (/aidbox-rpc)
notebook ──POST /api/fhir/Patient/$match──▶ mdmbox   (returns Bundle)
notebook ──Bundle──▶ Aidbox ──▶ browser
```

The Aidbox App manifest registered in Cell 1:

```json
{
  "resourceType": "App",
  "id": "mdmbox.match",
  "apiVersion": 1,
  "type": "app",
  "endpoint": { "type": "http-rpc", "url": "http://notebook:3300/aidbox-rpc", "secret": "…" },
  "operations": { "patient-match": { "method": "POST", "path": ["fhir", "Patient", "$match"] } }
}
```

## Run with Docker Compose (recommended)

```bash
docker compose up
```

This brings up `aidbox-db`, `mdmbox`, `aidbox`, and the `notebook`. Open:

- Notebook: http://localhost:3300
- Aidbox:   http://localhost:8888  (admin: `admin` / `password`)
- mdmbox:   http://localhost:3003

In mdmbox, install the matching model (`patient-mdl-default`) and load some patients
first — e.g. via the mdmbox `/welcome` page — then use the notebook's Cell 2.

## Run the notebook locally (Aidbox/mdmbox in Docker)

```bash
bun notebook.ts
```

Because Aidbox must reach this server over http-rpc, point it at the host:

```bash
APP_BASE_URL=http://host.docker.internal:3300 \
AIDBOX_URL=http://localhost:8888 \
MDMBOX_URL=http://localhost:3003 \
bun notebook.ts
```

## Configuration (env)

| Variable           | Default                            | Purpose                                          |
| ------------------ | ---------------------------------- | ------------------------------------------------ |
| `PORT`             | `3300`                             | Notebook server port                             |
| `AIDBOX_URL`       | `http://localhost:8888`            | Aidbox base URL (server-side calls)              |
| `PUBLIC_AIDBOX_URL`| `http://localhost:8888`            | Aidbox URL shown in the page text (display only) |
| `AIDBOX_AUTH`      | `Basic cm9vdDpyb290` (root:root)   | Auth for registering the App / calling `$match`  |
| `MDMBOX_URL`       | `http://localhost:3003`            | mdmbox base URL                                  |
| `MDMBOX_AUTH`      | _(unset)_                          | Optional auth for mdmbox                         |
| `MODEL_ID`         | `patient-mdl-default`              | MatchingModel id used for `$match`               |
| `APP_BASE_URL`     | `http://host.docker.internal:3300` | URL Aidbox uses to reach `/aidbox-rpc`           |
| `APP_ID`           | `mdmbox.match`                     | Aidbox App resource id                           |
| `APP_SECRET`       | `mdmbox-match-secret`              | http-rpc shared secret                           |
