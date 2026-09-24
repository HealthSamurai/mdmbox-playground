export {};
import { isDeepStrictEqual } from "node:util";
import { calculateGolden, type FhirResource } from "../interbox/src/mdm/planning.ts";

const aidboxUrl = process.env.AIDBOX_URL ?? "http://localhost:8890";
const portalUrl = process.env.PORTAL_URL ?? "http://localhost:8090";
const grafanaUrl = process.env.GRAFANA_URL ?? "http://localhost:3002";
const clickhouseUrl = process.env.CLICKHOUSE_URL ?? "http://localhost:8124";
const aidboxUser = process.env.AIDBOX_USER ?? "root";
const aidboxPassword = process.env.AIDBOX_PASSWORD ?? "showcase";
const clickhouseUser = process.env.CLICKHOUSE_USER ?? "default";
const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? "showcase";
const auth = `Basic ${Buffer.from(
  `${aidboxUser}:${aidboxPassword}`,
).toString("base64")}`;

type Resource = Record<string, unknown>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`INVARIANT FAILED: ${message}`);
  console.log(`✓ ${message}`);
}

async function search(resourceType: string) {
  const resources: Resource[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `${aidboxUrl}/fhir/${resourceType}?_count=500&_page=${page}`,
      { headers: { Authorization: auth, Accept: "application/fhir+json" } },
    );
    invariant(response.ok, `${resourceType} search is available`);
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

function hasProfile(resource: Resource, canonical: string) {
  return (
    (resource.meta as { profile?: string[] } | undefined)?.profile?.includes(
      canonical,
    ) ?? false
  );
}

function tag(resource: Resource, system: string) {
  return (
    resource.meta as
      | { tag?: Array<{ system?: string; code?: string }> }
      | undefined
  )?.tag?.find((candidate) => candidate.system === system)?.code;
}

function code(resource: Resource, system: string) {
  return (
    resource.code as
      | { coding?: Array<{ system?: string; code?: string }> }
      | undefined
  )?.coding?.find((candidate) => candidate.system === system)?.code;
}

function messageId(resource: Resource) {
  return (
    resource.identifier as
      | Array<{ system?: string; value?: string }>
      | undefined
  )?.find((identifier) => identifier.system === "urn:interbox:message-id")
    ?.value;
}

function taskInput(resource: Resource, payloadCode: string) {
  return (
    resource.input as
      | Array<{
          type?: { coding?: Array<{ system?: string; code?: string }> };
          valueCode?: string;
          valueInteger?: number;
        }>
      | undefined
  )?.find((input) =>
    input.type?.coding?.some(
      (coding) =>
        coding.system ===
          "https://mdm.health-samurai.io/fhir/CodeSystem/task-payload-type" &&
        coding.code === payloadCode,
    ),
  );
}

function golden(cluster: Resource) {
  return (cluster.contained as Resource[] | undefined)?.find(
    (resource) =>
      resource.resourceType === "Patient" && resource.id === "golden",
  );
}

function members(cluster: Resource): string[] {
  return (
    cluster.item as
      | Array<{ type?: string; resource?: { reference?: string } }>
      | undefined
  )
    ?.filter((item) => item.type === "alternate")
    .map((item) => item.resource?.reference)
    .filter((reference): reference is string => Boolean(reference)) ?? [];
}

function allMembers(linkage: Resource): string[] {
  return (
    linkage.item as
      | Array<{ resource?: { reference?: string } }>
      | undefined
  )
    ?.map((item) => item.resource?.reference)
    .filter((reference): reference is string => Boolean(reference)) ?? [];
}

function conditionKey(condition: Resource) {
  const coding = (
    condition.code as
      | { coding?: Array<{ system?: string; code?: string }> }
      | undefined
  )?.coding?.[0];
  return `${coding?.system ?? ""}|${coding?.code ?? ""}|${condition.onsetDateTime ?? ""}`;
}

function references(resource: Resource) {
  const found = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (
      "reference" in value &&
      typeof (value as { reference?: unknown }).reference === "string"
    ) {
      found.add((value as { reference: string }).reference);
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(resource);
  return found;
}

async function clickhouseCounts() {
  const response = await fetch(
    `${clickhouseUrl}/?database=analytics&user=${encodeURIComponent(clickhouseUser)}` +
      `&password=${encodeURIComponent(clickhousePassword)}`,
    {
      method: "POST",
      body: `
        SELECT
          (SELECT countIf(kind = 'source') FROM analytics.current_patient) AS sources,
          (SELECT count() FROM analytics.current_linkage) AS goldens,
          (SELECT count() FROM analytics.current_linkage) AS clusters,
          (SELECT count() FROM analytics.current_linkage_membership) AS memberships,
          (SELECT countIf(status = 'completed') FROM analytics.current_task) AS receipts,
          (SELECT countIf(status = 'completed' AND source_event IN ('A01', 'A04'))
             FROM analytics.current_task) AS creates,
          (SELECT countIf(status = 'completed' AND source_event = 'A08')
             FROM analytics.current_task) AS updates,
          (SELECT countIf(kind = 'source')
             FROM analytics.current_condition) AS conditions,
          (SELECT uniqExact(diagnosis_ref)
             FROM analytics.current_condition_fact) AS unique_conditions,
          (SELECT count()
             FROM analytics.current_condition_linkage) AS condition_linkages,
          (SELECT countIf(source_event IN ('A01', 'A04', 'A08') AND cas_replans >= 0)
             FROM analytics.current_task) AS telemetry_receipts,
          (SELECT countIf(cas_replans > 0) FROM analytics.current_task) AS cas_replans,
          (SELECT countIf(cas_replans > 1) FROM analytics.current_task) AS cas_contentions
        FORMAT JSONEachRow`,
    },
  );
  if (!response.ok) return null;
  return JSON.parse(await response.text());
}

async function clickhouseRows(sql: string): Promise<Record<string, unknown>[]> {
  const url = new URL(clickhouseUrl);
  url.searchParams.set("database", "analytics");
  url.searchParams.set("user", clickhouseUser);
  url.searchParams.set("password", clickhousePassword);
  const response = await fetch(url, { method: "POST", body: `${sql} FORMAT JSONEachRow` });
  if (!response.ok) throw new Error(`ClickHouse snapshot query failed: ${response.status}`);
  return (await response.text()).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

function sortedRows(rows: Record<string, unknown>[]) {
  return rows.sort((a, b) => JSON.stringify(Object.entries(a).sort()).localeCompare(JSON.stringify(Object.entries(b).sort())));
}

const [patients, linkages, conditions, tasks, provenances, basics] =
  await Promise.all([
  search("Patient"),
  search("Linkage"),
  search("Condition"),
  search("Task"),
  search("Provenance"),
  search("Basic"),
  ]);

const patientKindSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/patient-kind";
const linkageProfile =
  "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage";
const conditionLinkageProfile =
  "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-condition-linkage";
const operationCodeSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/operation-task-code";
const sources = patients.filter(
  (patient) => tag(patient, patientKindSystem) === "source",
);
const clusters = linkages.filter(
  (linkage) => hasProfile(linkage, linkageProfile) && linkage.active === true,
);
const conditionLinkages = linkages.filter(
  (linkage) =>
    hasProfile(linkage, conditionLinkageProfile) && linkage.active === true,
);
const receipts = tasks.filter(
  (task) =>
    task.status === "completed" &&
    ["link", "source-commit"].includes(
      code(task, operationCodeSystem) ?? "",
    ) &&
    Boolean(messageId(task)),
);
const linkTasks = receipts.filter(
  (task) => code(task, operationCodeSystem) === "link",
);
const createTasks = receipts.filter((task) =>
  ["A01", "A04"].includes(taskInput(task, "event")?.valueCode ?? ""),
);
const updateTasks = receipts.filter(
  (task) => taskInput(task, "event")?.valueCode === "A08",
);
const contentionTasks = receipts.filter(
  (task) =>
    Number(taskInput(task, "cas-replan-count")?.valueInteger ?? 0) > 1,
);
const membership = clusters.flatMap(members);
const conditionMembership = conditionLinkages.flatMap(allMembers);
const sourceReferences = new Set(sources.map((source) => `Patient/${source.id}`));
const conditionReferences = new Set(
  conditions.map((condition) => `Condition/${condition.id}`),
);
const conditionByReference = new Map(
  conditions.map((condition) => [
    `Condition/${condition.id}`,
    condition,
  ]),
);
const receiptReferences = new Set(receipts.map((task) => `Task/${task.id}`));
const sourceByReference = new Map(sources.map(source => [`Patient/${source.id}`, source]));
const logicalPatientBySource = new Map(clusters.flatMap(cluster => members(cluster).map(reference => [reference, `Linkage/${cluster.id}`] as const)));
const diagnosisByCondition = new Map(conditionLinkages.flatMap(linkage => allMembers(linkage).map(reference => [reference, `Linkage/${linkage.id}`] as const)));

invariant(sources.length > 0, "at least one source Patient exists");
invariant(
  patients.length === sources.length,
  "there are no top-level golden Patients",
);
invariant(
  clusters.every((cluster) => Boolean(golden(cluster))),
  "every Linkage contains a persisted golden Patient",
);
invariant(
  clusters.every((cluster) => members(cluster).length >= 2),
  "singleton Patients have no Linkage",
);
invariant(
  clusters.every(
    (cluster) =>
      (
        cluster.item as Array<{
          type?: string;
          resource?: { reference?: string };
        }>
      ).filter(
        (item) =>
          item.type === "source" && item.resource?.reference === "#golden",
      ).length === 1,
  ),
  "contained golden is the single Linkage source item",
);
invariant(
  new Set(membership).size === membership.length,
  "each source belongs to at most one active cluster",
);
invariant(
  membership.every((reference) => sourceReferences.has(reference)),
  "every Linkage member is a delivered source Patient",
);
invariant(clusters.every(cluster => isDeepStrictEqual(
  golden(cluster), calculateGolden(members(cluster).map(reference => sourceByReference.get(reference) as FhirResource)),
)), "stored golden fields equal the current source-priority calculation");
invariant(
  conditions.every((condition) =>
    sourceReferences.has(
      (condition.subject as { reference?: string } | undefined)?.reference ??
        "",
    ),
  ),
  "every Condition belongs to a delivered source Patient",
);
invariant(
  conditionLinkages.length > 0 &&
    conditionMembership.length < conditions.length,
  "the dataset contains both deduplicated and standalone diagnoses",
);
invariant(
  conditionLinkages.every(
    (linkage) =>
      allMembers(linkage).length >= 2 &&
      allMembers(linkage).every((reference) =>
        conditionReferences.has(reference),
      ),
  ),
  "every Condition Linkage contains at least two delivered Conditions",
);
invariant(
  new Set(conditionMembership).size === conditionMembership.length,
  "each source Condition belongs to at most one active equivalence group",
);
invariant(
  conditionLinkages.every((linkage) => {
    const keys = new Set(
      allMembers(linkage).map((reference) =>
        conditionKey(conditionByReference.get(reference)!),
      ),
    );
    return keys.size === 1;
  }),
  "Condition Linkage members have the same deterministic diagnosis key",
);
invariant(conditionLinkages.every(linkage => new Set(allMembers(linkage).map(reference => {
  const subject = (conditionByReference.get(reference)!.subject as { reference: string }).reference;
  return logicalPatientBySource.get(subject) ?? subject;
})).size === 1), "Condition equivalence never crosses logical Patient boundaries");
invariant(
  linkTasks.length === membership.length - clusters.length,
  "every cluster creation/extension selected one link branch per added member",
);
invariant(
  tasks.length === receipts.length &&
    receipts.every((task) => task.id === messageId(task)),
  "Task/{messageId} is the only completed idempotency receipt",
);
invariant(
  new Set(receipts.map(messageId)).size === receipts.length,
  "message ids are globally unique",
);
invariant(
  receipts.every((task) =>
    ["A01", "A04", "A08"].includes(
      taskInput(task, "event")?.valueCode ?? "",
    ),
  ),
  "every receipt records its source event",
);
invariant(
  receipts.every((task) => {
    const count = taskInput(task, "cas-replan-count")?.valueInteger;
    return Number.isInteger(count) && Number(count) >= 0;
  }),
  "every receipt records a non-negative CAS replan count",
);
invariant(
  provenances.length === receipts.length &&
    provenances.every((provenance) =>
      [...references(provenance)].some((reference) =>
        receiptReferences.has(reference),
      ),
    ),
  "every commit has one Provenance targeting its Task",
);

const revision = basics.find((basic) => basic.id === "mdm-revision");
const lastCommitted = (
  revision?.subject as { reference?: string } | undefined
)?.reference;
invariant(
  Boolean(revision?.meta) &&
    Boolean(lastCommitted) &&
    receiptReferences.has(lastCommitted!),
  "global MDM revision points to a committed message",
);

const expected = {
  sources: sources.length,
  goldens: clusters.length,
  clusters: clusters.length,
  memberships: membership.length,
  receipts: receipts.length,
  creates: createTasks.length,
  updates: updateTasks.length,
};
const uniqueConditionCount =
  conditions.length - conditionMembership.length + conditionLinkages.length;
const analyticsExpected = {
  ...expected,
  conditions: conditions.length,
  unique_conditions: uniqueConditionCount,
  condition_linkages: conditionLinkages.length,
};
const deadline = Date.now() + 90_000;
let analytics = await clickhouseCounts();
while (
  Date.now() < deadline &&
  (!analytics ||
    Object.entries(analyticsExpected).some(
      ([key, value]) => Number(analytics[key]) !== value,
    ))
) {
  await Bun.sleep(1_000);
  analytics = await clickhouseCounts();
}
invariant(Boolean(analytics), "ClickHouse analytics is queryable");
invariant(
  Object.entries(analyticsExpected).every(
    ([key, value]) => Number(analytics[key]) === value,
  ),
  "ClickHouse current views converge to Aidbox",
);
invariant(
  Number(analytics.telemetry_receipts) === receipts.length,
  "ClickHouse projects source events and CAS replans from every Task",
);
invariant(
  Number(analytics.creates) === createTasks.length &&
    Number(analytics.updates) === updateTasks.length,
  "ClickHouse derives create/update commits from Task source events",
);
invariant(
  Number(analytics.cas_contentions) === contentionTasks.length,
  "ClickHouse counts repeated CAS conflicts as contention",
);

const expectedSnapshots = [
  sources.map(source => ({ id: source.id, version: (source.meta as { versionId: string }).versionId })),
  clusters.flatMap(cluster => members(cluster).map(member_ref => ({ cluster_id: cluster.id, member_ref }))),
  conditions.map(condition => {
    const condition_ref = `Condition/${condition.id}`;
    const subject = (condition.subject as { reference: string }).reference;
    return { condition_ref, logical_patient_ref: logicalPatientBySource.get(subject) ?? subject, diagnosis_ref: diagnosisByCondition.get(condition_ref) ?? condition_ref };
  }),
  clusters.map(cluster => {
    const value = golden(cluster)!;
    const name = (value.name as Array<{ family?: string; given?: string[] }> | undefined)?.[0];
    return { cluster_id: cluster.id, golden_family: name?.family ?? null, golden_given: name?.given?.[0] ?? null, golden_birth_date: value.birthDate ?? null };
  }),
].map(sortedRows);
let exactSnapshots: Record<string, unknown>[][] = [];
const snapshotDeadline = Date.now() + 90_000;
do {
  exactSnapshots = (await Promise.all([
    clickhouseRows("SELECT id, version FROM analytics.current_patient WHERE kind = 'source'"),
    clickhouseRows("SELECT cluster_id, member_ref FROM analytics.current_linkage_membership"),
    clickhouseRows("SELECT condition_ref, logical_patient_ref, diagnosis_ref FROM analytics.current_condition_fact"),
    clickhouseRows("SELECT cluster_id, golden_family, golden_given, golden_birth_date FROM analytics.current_linkage"),
  ])).map(sortedRows);
  if (isDeepStrictEqual(exactSnapshots, expectedSnapshots)) break;
  await Bun.sleep(1000);
} while (Date.now() < snapshotDeadline);
invariant(isDeepStrictEqual(exactSnapshots, expectedSnapshots), "ClickHouse converges on exact source versions, membership, diagnosis ownership and golden values");

const portalResponse = await fetch(`${portalUrl}/api/state?pageSize=100`);
invariant(portalResponse.ok, "portal REST aggregation is available");
const portal = await portalResponse.json();
for (let page = 2; page <= portal.registry.totalPages; page++) {
  const response = await fetch(`${portalUrl}/api/state?pageSize=100&page=${page}`);
  invariant(response.ok, `portal registry page ${page} is available`);
  const next = await response.json();
  invariant(next.registry.total === portal.registry.total, "registry is stable during verification");
  portal.patientCards.push(...next.patientCards);
}
invariant(
  Object.entries(expected).every(
    ([key, value]) => Number(portal.aidbox[key]) === value,
  ) &&
    portal.aidbox.pending === 0 &&
    Number(portal.aidbox.conditions) === conditions.length &&
    Number(portal.aidbox.uniqueConditions) === uniqueConditionCount &&
    Number(portal.aidbox.conditionLinkages) === conditionLinkages.length,
  "portal presents the same Aidbox truth",
);
invariant(
  portal.patientCards.length ===
    clusters.length + sources.length - membership.length &&
    portal.registry.total === portal.patientCards.length &&
    portal.registry.page === 1 &&
    portal.patientCards.filter(
      (card: { kind?: string }) => card.kind === "golden",
    ).length === clusters.length &&
    portal.patientCards
      .filter((card: { kind?: string }) => card.kind === "golden")
      .reduce(
        (
          count: number,
          card: { sources?: Array<Record<string, unknown>> },
        ) => count + (card.sources?.length ?? 0),
        0,
      ) === membership.length,
  "portal renders one logical patient card with expandable source records",
);
invariant(
  portal.patientCards.reduce(
    (
      count: number,
      card: { totalConditionCount?: number },
    ) => count + Number(card.totalConditionCount ?? 0),
    0,
  ) === conditions.length &&
    portal.patientCards.reduce(
      (
        count: number,
        card: { uniqueConditionCount?: number },
      ) => count + Number(card.uniqueConditionCount ?? 0),
      0,
    ) === uniqueConditionCount &&
    portal.patientCards.every(
      (card: {
        conditions?: Array<{ evidence?: unknown[] }>;
        totalConditionCount?: number;
        uniqueConditionCount?: number;
        duplicateConditionCount?: number;
      }) =>
        (card.conditions ?? []).reduce(
          (count, condition) => count + (condition.evidence?.length ?? 0),
          0,
        ) === Number(card.totalConditionCount ?? 0) &&
        Number(card.duplicateConditionCount ?? 0) ===
          Number(card.totalConditionCount ?? 0) -
            Number(card.uniqueConditionCount ?? 0),
    ),
  "portal shows raw and deduplicated Condition counts per logical Patient",
);
invariant(
  portal.patientCards.some(
    (card: { totalConditionCount?: number }) =>
      Number(card.totalConditionCount ?? 0) === 0,
  ) &&
    portal.patientCards.some(
      (card: {
        totalConditionCount?: number;
        uniqueConditionCount?: number;
      }) =>
        Number(card.totalConditionCount ?? 0) >
        Number(card.uniqueConditionCount ?? 0),
    ) &&
    portal.patientCards.some(
      (card: { uniqueConditionCount?: number }) =>
        Number(card.uniqueConditionCount ?? 0) > 1,
    ),
  "portal covers zero, repeated, and distinct diagnoses",
);
const cardsWithRepeatedConditions = portal.patientCards.filter(
  (card: { duplicateConditionCount?: number }) =>
    Number(card.duplicateConditionCount ?? 0) > 0,
);
const repeatedConditionResponse = await fetch(
  `${portalUrl}/api/state?conditionDuplicates=present&pageSize=1`,
);
invariant(
  repeatedConditionResponse.ok,
  "portal repeat filter is available",
);
const repeatedConditionPage = await repeatedConditionResponse.json();
invariant(
  repeatedConditionPage.registry.total === cardsWithRepeatedConditions.length &&
    repeatedConditionPage.patientCards.length === 1 &&
    repeatedConditionPage.patientCards.every(
      (card: { duplicateConditionCount?: number }) =>
        Number(card.duplicateConditionCount ?? 0) > 0,
    ),
  "portal filters repeated Conditions before registry pagination",
);
const firstRegistryPageResponse = await fetch(
  `${portalUrl}/api/state?page=1&pageSize=20`,
);
invariant(firstRegistryPageResponse.ok, "portal registry page is available");
const firstRegistryPage = await firstRegistryPageResponse.json();
invariant(
  firstRegistryPage.patientCards.length ===
    Math.min(20, portal.registry.total) &&
    firstRegistryPage.registry.total === portal.registry.total &&
    firstRegistryPage.registry.totalPages ===
      Math.max(1, Math.ceil(portal.registry.total / 20)),
  "portal returns bounded registry pages with an exact total",
);
invariant(
  Object.entries(analyticsExpected).every(
    ([key, value]) => Number(portal.analytics[key]) === value,
  ),
  "portal exposes converged ClickHouse current views",
);
invariant(
  portal.destinations.length === 4 &&
    portal.destinations.every(
      (destination: { ok?: boolean }) => destination.ok === true,
    ),
  "all four AidboxTopicDestination endpoints are healthy",
);

const detailCard = portal.patientCards[0];
const detailResponse = await fetch(
  `${portalUrl}/patients/${detailCard.kind}/${detailCard.id}`,
);
invariant(
  detailResponse.ok &&
    (await detailResponse.text()).includes("Patient details"),
  "portal opens a logical Patient on a dedicated page",
);

const dashboardResponse = await fetch(
  `${grafanaUrl}/api/dashboards/uid/mdm-real-world`,
);
invariant(dashboardResponse.ok, "Grafana dashboard is provisioned");
const dashboard = (await dashboardResponse.json()).dashboard as {
  panels?: Array<{
    title?: string;
    type?: string;
    fieldConfig?: {
      defaults?: { decimals?: number; unit?: string };
    };
    options?: { colorMode?: string };
  }>;
};
const panels = dashboard.panels ?? [];
invariant(
  [
    "Singletons",
    "Source conditions",
    "Unique diagnoses",
    "CAS replans",
    "CAS contention",
    "Cluster sizes",
  ]
    .every((title) => panels.some((panel) => panel.title === title)),
  "Grafana separates CAS replans from real contention",
);
invariant(
  panels
    .filter((panel) => panel.type === "stat")
    .every((panel) => panel.options?.colorMode === "value"),
  "Grafana stat panels use restrained value-only colors",
);
invariant(
  panels.every(
    (panel) =>
      panel.fieldConfig?.defaults?.decimals === 0 &&
      panel.fieldConfig.defaults.unit === "none",
  ),
  "Grafana renders all dashboard counts as full integers",
);

console.log(
  `\nE2E VERIFIED: ${sources.length} sources, ${clusters.length} clusters, ` +
    `${sources.length - membership.length} standalone, ${conditions.length} source Conditions, ` +
    `${uniqueConditionCount} unique diagnoses, ${receipts.length} receipts, ` +
    `${analytics.cas_replans} CAS-replan messages, ` +
    `${analytics.cas_contentions} contention messages`,
);
