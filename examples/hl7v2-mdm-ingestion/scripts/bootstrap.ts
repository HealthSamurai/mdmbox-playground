export {};
import { analyticsSchema } from "./analytics.ts";

const AIDBOX_URL = process.env.AIDBOX_URL ?? "http://localhost:8890";
const MDMBOX_URL = process.env.MDMBOX_URL ?? "http://localhost:3005";
const CLICKHOUSE_URL =
  process.env.CLICKHOUSE_URL ?? "http://localhost:8124";
const AIDBOX_USER = process.env.AIDBOX_USER ?? "root";
const AIDBOX_PASSWORD = process.env.AIDBOX_PASSWORD ?? "showcase";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER ?? "default";
const CLICKHOUSE_PASSWORD =
  process.env.CLICKHOUSE_PASSWORD ?? "showcase";

const auth = `Basic ${Buffer.from(
  `${AIDBOX_USER}:${AIDBOX_PASSWORD}`,
).toString("base64")}`;

async function request(
  url: string,
  init: RequestInit = {},
  accepted = [200, 201],
) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!accepted.includes(response.status)) {
    throw new Error(
      `${init.method ?? "GET"} ${url} returned ${response.status}: ${text}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

async function putFhir(resource: Record<string, unknown>) {
  return request(
    `${AIDBOX_URL}/fhir/${resource.resourceType}/${resource.id}`,
    {
      method: "PUT",
      headers: {
        Authorization: auth,
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify(resource),
    },
    [200, 201],
  );
}

async function createFhir(resource: Record<string, unknown>) {
  return request(
    `${AIDBOX_URL}/fhir/${resource.resourceType}`,
    {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify(resource),
    },
    [200, 201],
  );
}

async function clickhouse(sql: string) {
  const url =
    `${CLICKHOUSE_URL}/?database=analytics` +
    `&user=${encodeURIComponent(CLICKHOUSE_USER)}` +
    `&password=${encodeURIComponent(CLICKHOUSE_PASSWORD)}`;
  const response = await fetch(url, { method: "POST", body: sql });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `ClickHouse returned ${response.status} for ${sql.slice(0, 80)}: ${text}`,
    );
  }
}

async function clickhouseStatements(sql: string) {
  for (const statement of sql.split(";").map((part) => part.trim())) {
    if (statement) await clickhouse(statement);
  }
}

const matchingModel = {
  id: "showcase-patient",
  resource: "Patient",
  variable: [
    { name: "birthDate", expression: "(#.resource->>'birthDate')" },
    { name: "given", expression: "(#.resource#>>'{name,0,given,0}')" },
    { name: "family", expression: "(#.resource#>>'{name,0,family}')" },
  ],
  block: [
    { name: "birthDate", variable: "birthDate" },
  ],
  feature: [
    {
      name: "birthDate",
      case: [
        { weight: 4, expression: "l.#birthDate = r.#birthDate" },
        { else: -4 },
      ],
    },
    {
      name: "given",
      case: [
        { weight: 4, expression: "l.#given = r.#given" },
        { else: -4 },
      ],
    },
    {
      name: "family",
      case: [
        { weight: 3, expression: "l.#family = r.#family" },
        { else: -3 },
      ],
    },
  ],
  thresholds: { certain: 8, probable: 3 },
};

async function ensureMatchingModel(model: { id: string }) {
  const get = await fetch(`${MDMBOX_URL}/api/models/${model.id}`);
  const method = get.status === 404 ? "POST" : "PUT";
  const path =
    method === "POST"
      ? `${MDMBOX_URL}/api/models`
      : `${MDMBOX_URL}/api/models/${model.id}`;
  await request(path, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(model),
  });
}

const coordinationResources = [
  {
    resourceType: "Organization",
    id: "interbox",
    active: true,
    name: "Interbox",
  },
  {
    resourceType: "Device",
    id: "interbox",
    status: "active",
    deviceName: [{ name: "Interbox", type: "user-friendly-name" }],
  },
  {
    resourceType: "Basic",
    id: "mdm-revision",
    code: {
      coding: [
        {
          system:
            "https://mdm.health-samurai.io/fhir/CodeSystem/coordination-state",
          code: "mdm-coordination-state",
        },
      ],
    },
  },
];

const operationSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/operation-task-code";
const taskPayloadTypeSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/task-payload-type";
const patientKindSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/patient-kind";
const sourceSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/source-system";
const conditionKindSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/condition-kind";
const patientLinkageProfile =
  "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage";
const conditionLinkageProfile =
  "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-condition-linkage";

const viewDefinitions = [
  {
    resourceType: "ViewDefinition",
    id: "mdm_patient_events",
    url: "https://mdm.health-samurai.io/fhir/ViewDefinition/mdm-patient-events",
    name: "mdm_patient_events",
    status: "active",
    resource: "Patient",
    select: [
      {
        column: [
          { name: "id", path: "id" },
          { name: "version", path: "meta.versionId" },
          {
            name: "kind",
            path: `meta.tag.where(system = '${patientKindSystem}').code.first()`,
          },
          {
            name: "source",
            path: `meta.tag.where(system = '${sourceSystem}').code.first()`,
          },
          { name: "family", path: "name.first().family" },
          { name: "given", path: "name.first().given.join(' ')" },
          { name: "birth_date", path: "birthDate" },
        ],
      },
    ],
  },
  {
    resourceType: "ViewDefinition",
    id: "mdm_linkage_events",
    url: "https://mdm.health-samurai.io/fhir/ViewDefinition/mdm-linkage-events",
    name: "mdm_linkage_events",
    status: "active",
    resource: "Linkage",
    select: [
      {
        column: [
          { name: "cluster_id", path: "id" },
          { name: "version", path: "meta.versionId" },
          { name: "profile", path: "meta.profile.first()" },
          { name: "active", path: "active" },
          {
            name: "member_refs",
            path: "item.where(type = 'alternate').resource.id.join('|')",
          },
          {
            name: "source_ref",
            path: "item.where(type = 'source').resource.id.first()",
          },
          {
            name: "item_refs",
            path: "item.resource.reference.join('|')",
          },
          {
            name: "golden_family",
            path: "contained.where(id = 'golden').name.first().family",
          },
          {
            name: "golden_given",
            path: "contained.where(id = 'golden').name.first().given.join(' ')",
          },
          {
            name: "golden_birth_date",
            path: "contained.where(id = 'golden').birthDate",
          },
          {
            name: "golden_phone",
            path: "contained.where(id = 'golden').telecom.where(system = 'phone').value.first()",
          },
        ],
      },
    ],
  },
  {
    resourceType: "ViewDefinition",
    id: "mdm_condition_events",
    url: "https://mdm.health-samurai.io/fhir/ViewDefinition/mdm-condition-events",
    name: "mdm_condition_events",
    status: "active",
    resource: "Condition",
    select: [
      {
        column: [
          { name: "id", path: "id" },
          { name: "version", path: "meta.versionId" },
          {
            name: "kind",
            path: `meta.tag.where(system = '${conditionKindSystem}').code.first()`,
          },
          {
            name: "source",
            path: `meta.tag.where(system = '${sourceSystem}').code.first()`,
          },
          { name: "subject_id", path: "subject.getReferenceKey(Patient)" },
          { name: "code_system", path: "code.coding.first().system" },
          { name: "code", path: "code.coding.first().code" },
          { name: "display", path: "code.coding.first().display" },
          { name: "onset", path: "onset.ofType(dateTime)" },
        ],
      },
    ],
  },
  {
    resourceType: "ViewDefinition",
    id: "mdm_task_events",
    url: "https://mdm.health-samurai.io/fhir/ViewDefinition/mdm-task-events",
    name: "mdm_task_events",
    status: "active",
    resource: "Task",
    select: [
      {
        column: [
          { name: "id", path: "id" },
          { name: "version", path: "meta.versionId" },
          { name: "status", path: "status" },
          {
            name: "operation",
            path: `code.coding.where(system = '${operationSystem}').code.first()`,
          },
          { name: "request_key", path: "identifier.value.first()" },
          { name: "focus_ref", path: "focus.reference" },
          {
            name: "source_event",
            path: `input.where(type.coding.where(system = '${taskPayloadTypeSystem}').code = 'event').value.ofType(code).first()`,
          },
          {
            name: "cas_replans",
            path: `input.where(type.coding.where(system = '${taskPayloadTypeSystem}').code = 'cas-replan-count').value.ofType(integer).first()`,
          },
        ],
      },
    ],
  },
];

const topics = [
  ["patient", "Patient"],
  ["linkage", "Linkage"],
  ["condition", "Condition"],
  ["task", "Task"],
].map(([name, resource]) => ({
  resourceType: "AidboxSubscriptionTopic",
  id: `mdm-${name}-changes`,
  url: `https://mdm.health-samurai.io/fhir/SubscriptionTopic/${name}-changes`,
  status: "active",
  trigger: [
    {
      resource,
      supportedInteraction: ["create", "update", "delete"],
    },
  ],
}));

const destinationProfile =
  "http://health-samurai.io/fhir/core/StructureDefinition/aidboxtopicdestination-clickHouseAtLeastOnceProfile";

const destinations = [
  ["patient", "mdm_patient_events", "patient_events"],
  ["linkage", "mdm_linkage_events", "linkage_events"],
  ["condition", "mdm_condition_events", "condition_events"],
  ["task", "mdm_task_events", "task_events"],
].map(([name, viewDefinition, destinationTable]) => ({
  resourceType: "AidboxTopicDestination",
  id: `${name}-clickhouse`,
  meta: { profile: [destinationProfile] },
  topic: `https://mdm.health-samurai.io/fhir/SubscriptionTopic/${name}-changes`,
  kind: "clickhouse-at-least-once",
  parameter: [
    { name: "url", valueString: "http://clickhouse:8123" },
    { name: "database", valueString: "analytics" },
    { name: "user", valueString: CLICKHOUSE_USER },
    { name: "password", valueString: CLICKHOUSE_PASSWORD },
    { name: "viewDefinition", valueString: viewDefinition },
    { name: "destinationTable", valueString: destinationTable },
    { name: "batchSize", valueUnsignedInt: 20 },
    { name: "sendIntervalMs", valueUnsignedInt: 1000 },
  ],
}));

async function createAnalyticsSchema() {
  await clickhouseStatements(analyticsSchema);
}

async function materialize(viewDefinition: typeof viewDefinitions[number]) {
  // Aidbox 2608.4 events include meta.versionId; SQL snapshots expose it as txid.
  // The pinned destination module reuses this SQL for both shapes of row r.
  const snapshotDefinition = structuredClone(viewDefinition);
  for (const select of snapshotDefinition.select) {
    for (const column of select.column) {
      if (column.name === "version") column.path = "getAidboxTxid()";
    }
  }
  await request(
    `${AIDBOX_URL}/fhir/ViewDefinition/$materialize`,
    {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify({
        resourceType: "Parameters",
        parameter: [
          { name: "type", valueCode: "view" },
          { name: "viewResource", resource: snapshotDefinition },
        ],
      }),
    },
    [200, 201],
  );
  const sqlHeaders = { Authorization: auth, "Content-Type": "application/json" };
  const [{ sql }] = await request(`${AIDBOX_URL}/$sql`, {
    method: "POST", headers: sqlHeaders,
    body: JSON.stringify(["SELECT pg_get_viewdef(?::regclass, true) AS sql", `sof.${viewDefinition.name}`]),
  });
  if ((sql.match(/\btxid AS version/g) ?? []).length !== 1) {
    throw new Error(`Unexpected version projection in ${viewDefinition.name}; check Aidbox compatibility`);
  }
  const compatibleSql = sql.replace(/\btxid AS version/, "coalesce((resource #>> '{meta,versionId}')::bigint, (to_jsonb(r)->>'txid')::bigint) AS version");
  await request(`${AIDBOX_URL}/$sql`, {
    method: "POST", headers: sqlHeaders,
    body: JSON.stringify(`CREATE OR REPLACE VIEW sof.${viewDefinition.name} AS ${compatibleSql}`),
  });
}

async function ensureDestination(destination: Record<string, unknown>) {
  const url = `${AIDBOX_URL}/fhir/AidboxTopicDestination/${destination.id}`;
  const response = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/fhir+json" },
  });
  if (response.ok) {
    await request(
      url,
      {
        method: "DELETE",
        headers: { Authorization: auth, Accept: "application/fhir+json" },
      },
      [200, 204],
    );
  } else if (response.status !== 404) {
    throw new Error(
      `Destination lookup ${destination.id} returned ${response.status}`,
    );
  }
  await createFhir(destination);
}

console.log("bootstrap: ClickHouse tables and current-state views");
await createAnalyticsSchema();
console.log("bootstrap: Interbox author, agent and global MDM revision");
for (const resource of coordinationResources) {
  const response = await fetch(`${AIDBOX_URL}/fhir/${resource.resourceType}/${resource.id}`, { headers: { Authorization: auth } });
  if (response.status === 404 || response.status === 410) await putFhir(resource);
  else if (!response.ok) throw new Error(`Coordination resource lookup failed: ${response.status}`);
}
await putFhir(await Bun.file(new URL("../fhir/mdm-condition-linkage.json", import.meta.url)).json());
console.log("bootstrap: Patient matching model");
await ensureMatchingModel(matchingModel);

console.log("bootstrap: SQL-on-FHIR ViewDefinitions");
for (const definition of viewDefinitions) {
  await putFhir(definition);
  await materialize(definition);
}
console.log("bootstrap: subscription topics");
for (const topic of topics) await putFhir(topic);
console.log("bootstrap: at-least-once ClickHouse destinations");
for (const destination of destinations) await ensureDestination(destination);
console.log("bootstrap: complete");
