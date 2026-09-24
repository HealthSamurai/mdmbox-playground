const aidboxUrl = process.env.AIDBOX_URL ?? "http://localhost:8890";
const clickhouseUrl = process.env.CLICKHOUSE_URL ?? "http://localhost:8124";
const aidboxUser = process.env.AIDBOX_USER ?? "root";
const aidboxPassword = process.env.AIDBOX_PASSWORD ?? "showcase";
const clickhouseUser = process.env.CLICKHOUSE_USER ?? "default";
const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? "showcase";
const auth = `Basic ${Buffer.from(
  `${aidboxUser}:${aidboxPassword}`,
).toString("base64")}`;

type Resource = {
  resourceType: string;
  id: string;
  meta?: { versionId?: string };
  [key: string]: unknown;
};

async function search(resourceType: string): Promise<Resource[]> {
  const resources: Resource[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `${aidboxUrl}/fhir/${resourceType}?_count=500&_page=${page}`,
      { headers: { Authorization: auth, Accept: "application/fhir+json" } },
    );
    if (!response.ok) {
      throw new Error(
        `${resourceType} search returned ${response.status}: ${await response.text()}`,
      );
    }
    const bundle = await response.json();
    const entries = bundle.entry ?? [];
    resources.push(
      ...entries.map((entry: { resource: Resource }) => entry.resource),
    );
    if (entries.length < 500 || page * 500 >= (bundle.total ?? 0)) break;
    page += 1;
  }

  return resources;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function deleteResources(resources: Resource[]) {
  for (const batch of chunks(resources, 100)) {
    const response = await fetch(`${aidboxUrl}/fhir`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify({
        resourceType: "Bundle",
        type: "transaction",
        entry: batch.map((resource) => ({
          request: {
            method: "DELETE",
            url: `${resource.resourceType}/${resource.id}`,
            ...(resource.meta?.versionId
              ? { ifMatch: `W/"${resource.meta.versionId}"` }
              : {}),
          },
        })),
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `FHIR delete transaction returned ${response.status}: ${body}`,
      );
    }
    const bundle = body ? JSON.parse(body) : {};
    const failed = (bundle.entry ?? []).find(
      (entry: { response?: { status?: string } }) =>
        !entry.response?.status?.startsWith("2"),
    );
    if (failed) {
      throw new Error(
        `FHIR delete entry failed: ${JSON.stringify(failed.response)}`,
      );
    }
  }
}

async function resetMdmRevision() {
  const response = await fetch(`${aidboxUrl}/fhir/Basic/mdm-revision`, {
    headers: { Authorization: auth, Accept: "application/fhir+json" },
  });
  if (response.status === 404 || response.status === 410) return;
  if (!response.ok) {
    throw new Error(`Basic/mdm-revision read returned ${response.status}`);
  }

  const revision = (await response.json()) as Resource;
  const version = revision.meta?.versionId;
  const { meta: _serverMeta, ...body } = revision;
  delete body.subject;

  const update = await fetch(`${aidboxUrl}/fhir/Basic/mdm-revision`, {
    method: "PUT",
    headers: {
      Authorization: auth,
      "Content-Type": "application/fhir+json",
      Accept: "application/fhir+json",
      ...(version ? { "If-Match": `W/"${version}"` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!update.ok) {
    throw new Error(
      `Basic/mdm-revision reset returned ${update.status}: ${await update.text()}`,
    );
  }
}

async function clickhouse(sql: string) {
  const response = await fetch(
    `${clickhouseUrl}/?database=analytics` +
      `&user=${encodeURIComponent(clickhouseUser)}` +
      `&password=${encodeURIComponent(clickhousePassword)}`,
    { method: "POST", body: sql },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`ClickHouse returned ${response.status}: ${body}`);
  }
  return body;
}

async function waitForEmptyAnalytics() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const body = await clickhouse(`
      SELECT
        (SELECT count() FROM analytics.current_patient) AS patients,
        (SELECT count() FROM analytics.current_linkage) AS linkages,
        (SELECT count() FROM analytics.current_condition) AS conditions,
        (SELECT count() FROM analytics.current_task) AS tasks
      FORMAT JSONEachRow
    `);
    const counts = JSON.parse(body);
    if (
      counts.patients === 0 &&
      counts.linkages === 0 &&
      counts.conditions === 0 &&
      counts.tasks === 0
    ) {
      return;
    }
    await Bun.sleep(1_000);
  }
  throw new Error("ClickHouse current views did not converge to an empty state");
}

const [patients, linkages, conditions, tasks, provenances] = await Promise.all([
  search("Patient"),
  search("Linkage"),
  search("Condition"),
  search("Task"),
  search("Provenance"),
]);

console.log(
  `clear: deleting ${patients.length} Patients, ${linkages.length} Linkages, ` +
    `${conditions.length} Conditions, ${tasks.length} Tasks, ` +
    `${provenances.length} Provenances`,
);

await deleteResources(provenances);
await deleteResources(linkages);
await deleteResources(tasks);
await deleteResources(conditions);
await deleteResources(patients);
await resetMdmRevision();
await waitForEmptyAnalytics();
await clickhouse("TRUNCATE TABLE analytics.patient_events");
await clickhouse("TRUNCATE TABLE analytics.linkage_events");
await clickhouse("TRUNCATE TABLE analytics.condition_events");
await clickhouse("TRUNCATE TABLE analytics.task_events");

console.log("DATA CLEARED: Aidbox operational resources and ClickHouse state/history");

export {};
