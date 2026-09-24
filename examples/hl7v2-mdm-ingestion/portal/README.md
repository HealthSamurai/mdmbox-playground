# HL7v2 ingestion portal

Small-dataset portal for [HL7v2 ingestion with MDM](../README.md). It displays logical patients, contained golden views, original source records, diagnosis evidence and Aidbox/ClickHouse counts.

Run the complete example with `../showcase up`. For local development:

```bash
npm ci
npm run dev -- --port 8090
```

The backend defaults to Aidbox on localhost:8890 and ClickHouse on localhost:8124. Environment variables: `AIDBOX_URL`, `AIDBOX_USER`, `AIDBOX_PASSWORD`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`.

```bash
npm test
npm run lint
```

The API loads all source resources before grouping, filtering and pagination. Keep the dataset small. This read-only portal does not implement review decisions or a production patient search index.
