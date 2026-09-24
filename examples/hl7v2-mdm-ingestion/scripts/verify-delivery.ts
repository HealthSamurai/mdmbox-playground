import assert from "node:assert/strict";

const aidbox = process.env.AIDBOX_URL ?? "http://localhost:8890";
const auth = `Basic ${Buffer.from(`${process.env.AIDBOX_USER ?? "root"}:${process.env.AIDBOX_PASSWORD ?? "showcase"}`).toString("base64")}`;
const clickhouse = new URL(process.env.CLICKHOUSE_URL ?? "http://localhost:8124");
clickhouse.searchParams.set("user", process.env.CLICKHOUSE_USER ?? "default");
clickhouse.searchParams.set("password", process.env.CLICKHOUSE_PASSWORD ?? "showcase");
const id = `delivery-check-${crypto.randomUUID()}`;

async function write(method: string, body?: unknown) {
  const response = await fetch(`${aidbox}/fhir/Patient/${id}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/fhir+json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `${method} Patient returned ${response.status}: ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}

async function waitForSnapshot(expected: unknown[]) {
  let actual: unknown;
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(clickhouse, {
      method: "POST",
      body: `SELECT id, version, family FROM analytics.current_patient WHERE id = '${id}' FORMAT JSONEachRow`,
    });
    const text = await response.text();
    assert.ok(response.ok, text);
    actual = text.trim() ? text.trim().split("\n").map(line => JSON.parse(line)) : [];
    if (JSON.stringify(actual) === JSON.stringify(expected)) return;
    await Bun.sleep(1000);
  }
  assert.deepEqual(actual, expected, "ClickHouse snapshot must converge");
}

let created = false;
try {
  const patient = await write("PUT", { resourceType: "Patient", id, name: [{ family: "Before" }] });
  created = true;
  const expected = [{ id, version: patient.meta.versionId, family: "Before" }];
  await waitForSnapshot(expected);
  console.log("delivery: create event and resource version agree");
  const child = Bun.spawn(["./showcase", "bootstrap"], { cwd: new URL("..", import.meta.url).pathname, stdout: "inherit", stderr: "inherit" });
  assert.equal(await child.exited, 0, "bootstrap with existing data must succeed");
  // Wait for initial export itself, not just the already-correct current view.
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(clickhouse, { method: "POST", body: `SELECT count() AS deliveries, countIf(version = '') AS missing_version FROM analytics.patient_events WHERE id = '${id}' FORMAT JSONEachRow` });
    assert.ok(response.ok, await response.clone().text());
    const row = JSON.parse(await response.text());
    assert.equal(Number(row.missing_version), 0, "initial export must include the resource version");
    if (Number(row.deliveries) >= 2) break;
    assert.ok(attempt < 59, "initial export must deliver the existing Patient");
    await Bun.sleep(1000);
  }
  await waitForSnapshot(expected);
  console.log("delivery: bootstrap re-export preserves the version");
  const updated = await write("PUT", { resourceType: "Patient", id });
  await waitForSnapshot([{ id, version: updated.meta.versionId, family: null }]);
  console.log("delivery: update clears a previously populated field");
  await write("DELETE");
  created = false;
  await waitForSnapshot([]);
  console.log("DELIVERY VERIFIED: create, initial export, update and deletion");
} finally {
  if (created) await write("DELETE");
}
