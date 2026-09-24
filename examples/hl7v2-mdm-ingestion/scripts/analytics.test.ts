import { expect, test } from "bun:test";
import { analyticsSchema } from "./analytics.ts";

test("current views handle null clearing, duplicate delivery, old events and tombstones", async () => {
  const endpoint = new URL(process.env.CLICKHOUSE_URL ?? "http://localhost:8124");
  endpoint.searchParams.set("user", process.env.CLICKHOUSE_USER ?? "default");
  endpoint.searchParams.set("password", process.env.CLICKHOUSE_PASSWORD ?? "showcase");
  const database = "empi_analytics_test";
  async function query(sql: string) {
    const response = await fetch(endpoint, { method: "POST", body: sql });
    const body = await response.text();
    if (!response.ok) throw new Error(body);
    return body;
  }
  try {
    for (const sql of analyticsSchema.replaceAll("analytics", database).split(";").filter(s => s.trim())) await query(sql);
    await query(`INSERT INTO ${database}.patient_events (id, version, kind, family, is_deleted) VALUES
      ('p', '1', 'source', 'Old', 0), ('p', '2', 'source', NULL, 0),
      ('p', '1', 'source', 'Old', 0), ('p', '2', 'source', NULL, 0)`);
    const current = JSON.parse(await query(`SELECT id, version, family FROM ${database}.current_patient FORMAT JSONEachRow`));
    expect(current).toEqual({ id: "p", version: "2", family: null });
    await query(`INSERT INTO ${database}.patient_events (id, version, kind, family, is_deleted) VALUES ('p', '2', NULL, NULL, 1), ('p', '2', 'source', NULL, 0)`);
    expect((await query(`SELECT count() FROM ${database}.current_patient`)).trim()).toBe("0");
    await query(`INSERT INTO ${database}.patient_events (id, version, kind, family, is_deleted) VALUES ('p', '3', 'source', 'Recreated', 0)`);
    expect(JSON.parse(await query(`SELECT family FROM ${database}.current_patient FORMAT JSONEachRow`))).toEqual({ family: "Recreated" });
  } finally {
    await query(`DROP DATABASE IF EXISTS ${database}`);
  }
});
