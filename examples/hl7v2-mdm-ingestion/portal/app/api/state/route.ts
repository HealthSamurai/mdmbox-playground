import { paginateRegistry, parseRegistryQuery } from "./registry";

const MDM_LINKAGE_PROFILE =
  "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage";
const MDM_CONDITION_LINKAGE_PROFILE =
  "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-condition-linkage";
const OPERATION_CODE_SYSTEM =
  "https://mdm.health-samurai.io/fhir/CodeSystem/operation-task-code";
const PATIENT_KIND_SYSTEM =
  "https://mdm.health-samurai.io/fhir/CodeSystem/patient-kind";
const SOURCE_SYSTEM =
  "https://mdm.health-samurai.io/fhir/CodeSystem/source-system";
const MESSAGE_ID_SYSTEM = "urn:interbox:message-id";
const TASK_PAYLOAD_TYPE_SYSTEM =
  "https://mdm.health-samurai.io/fhir/CodeSystem/task-payload-type";

type Resource = {
  resourceType: string;
  id: string;
  meta?: {
    profile?: string[];
    tag?: Array<{ system?: string; code?: string }>;
    versionId?: string;
    lastUpdated?: string;
  };
  [key: string]: unknown;
};

type Bundle = {
  total?: number;
  entry?: Array<{ resource: Resource }>;
};

function basicAuth(): string {
  const user = process.env.AIDBOX_USER ?? "root";
  const password = process.env.AIDBOX_PASSWORD ?? "showcase";
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

async function aidbox(path: string): Promise<Response> {
  const base = process.env.AIDBOX_URL ?? "http://localhost:8890";
  return fetch(`${base}${path}`, {
    headers: { Authorization: basicAuth(), Accept: "application/fhir+json" },
    cache: "no-store",
    redirect: "manual",
  });
}

async function resources(resourceType: string): Promise<Resource[]> {
  const result: Resource[] = [];
  let page = 1;

  while (true) {
    const response = await aidbox(
      `/fhir/${resourceType}?_count=500&_page=${page}`,
    );
    if (response.status === 302) {
      throw new Error("Aidbox requires an active license (HTTP 302)");
    }
    if (!response.ok) {
      throw new Error(`${resourceType} search returned ${response.status}`);
    }
    const bundle = (await response.json()) as Bundle;
    const entries = bundle.entry ?? [];
    result.push(...entries.map((entry) => entry.resource));
    if (entries.length < 500 || page * 500 >= (bundle.total ?? 0)) break;
    page += 1;
  }

  return result;
}

function profile(resource: Resource, canonical: string): boolean {
  return resource.meta?.profile?.includes(canonical) ?? false;
}

function tag(resource: Resource, system: string): string | undefined {
  return resource.meta?.tag?.find((candidate) => candidate.system === system)
    ?.code;
}

function coding(
  resource: Resource,
  system: string,
  code: string,
): boolean {
  const codings = (
    resource.code as { coding?: Array<{ system?: string; code?: string }> }
  )?.coding;
  return codings?.some(
    (candidate) => candidate.system === system && candidate.code === code,
  ) ?? false;
}

function taskEvent(task: Resource): string | undefined {
  return (
    task.input as
      | Array<{
          type?: { coding?: Array<{ system?: string; code?: string }> };
          valueCode?: string;
        }>
      | undefined
  )?.find((input) =>
    input.type?.coding?.some(
      (candidate) =>
        candidate.system === TASK_PAYLOAD_TYPE_SYSTEM &&
        candidate.code === "event",
    ),
  )?.valueCode;
}

function reference(value: unknown): string | undefined {
  return (value as { reference?: string } | undefined)?.reference;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function displayName(patient: Resource | undefined): string {
  if (!patient) return "Golden view unavailable";
  const firstName = (
    patient.name as
      | Array<{ family?: string; given?: string[]; text?: string }>
      | undefined
  )?.[0];
  const assembled = [...(firstName?.given ?? []), firstName?.family]
    .filter(Boolean)
    .join(" ");
  return firstName?.text || assembled || patient.id;
}

function patientSummary(patient: Resource) {
  const address = (
    patient.address as
      | Array<{
          line?: string[];
          city?: string;
          postalCode?: string;
          country?: string;
        }>
      | undefined
  )?.[0];
  return {
    id: patient.id,
    version: patient.meta?.versionId ?? "—",
    updatedAt: patient.meta?.lastUpdated ?? null,
    kind: tag(patient, PATIENT_KIND_SYSTEM) ?? "unknown",
    source: tag(patient, SOURCE_SYSTEM) ?? null,
    name: displayName(patient),
    birthDate: patient.birthDate ?? null,
    gender: patient.gender ?? null,
    phone:
      (
        patient.telecom as
          | Array<{ system?: string; value?: string }>
          | undefined
      )?.find((telecom) => telecom.system === "phone")?.value ?? null,
    address:
      [
        ...(address?.line ?? []),
        address?.city,
        address?.postalCode,
        address?.country,
      ]
        .filter(Boolean)
        .join(", ") || null,
    identifiers: (
      (patient.identifier as
        | Array<{ system?: string; value?: string }>
        | undefined) ?? []
    ).map((identifier) => ({
      system: identifier.system ?? "—",
      value: identifier.value ?? "—",
    })),
  };
}

function conditionSummary(condition: Resource) {
  const primaryCoding = (
    condition.code as
      | {
          coding?: Array<{
            system?: string;
            code?: string;
            display?: string;
          }>;
          text?: string;
        }
      | undefined
  );
  const coding = primaryCoding?.coding?.[0];
  return {
    id: condition.id,
    reference: `Condition/${condition.id}`,
    version: condition.meta?.versionId ?? "—",
    source: tag(condition, SOURCE_SYSTEM) ?? null,
    subject: reference(condition.subject) ?? null,
    system: coding?.system ?? null,
    code: coding?.code ?? null,
    display: coding?.display ?? primaryCoding?.text ?? coding?.code ?? condition.id,
    onset: stringValue(condition.onsetDateTime),
    recordedDate: stringValue(condition.recordedDate),
  };
}

async function analyticsState() {
  const base = process.env.CLICKHOUSE_URL ?? "http://localhost:8124";
  const query = `
    SELECT
      (SELECT countIf(kind = 'source') FROM analytics.current_patient) AS sources,
      (SELECT count() FROM analytics.current_linkage) AS goldens,
      (SELECT count() FROM analytics.current_linkage) AS clusters,
      (SELECT count() FROM analytics.current_linkage_membership) AS memberships,
      (SELECT countIf(status = 'completed')
         FROM analytics.current_task) AS receipts,
      (SELECT countIf(status = 'completed' AND source_event IN ('A01', 'A04'))
         FROM analytics.current_task) AS creates,
      (SELECT countIf(status = 'completed' AND source_event = 'A08')
         FROM analytics.current_task) AS updates,
      (SELECT countIf(kind = 'source')
         FROM analytics.current_condition) AS conditions,
      (SELECT uniqExact(diagnosis_ref)
         FROM analytics.current_condition_fact) AS unique_conditions,
      (SELECT count()
         FROM analytics.current_condition_linkage) AS condition_linkages
    FORMAT JSONEachRow`;
  const response = await fetch(
    `${base}/?database=analytics&user=${encodeURIComponent(process.env.CLICKHOUSE_USER ?? "default")}` +
      `&password=${encodeURIComponent(process.env.CLICKHOUSE_PASSWORD ?? "showcase")}`,
    { method: "POST", body: query, cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`ClickHouse returned ${response.status}`);
  }
  return JSON.parse(await response.text()) as Record<string, number>;
}

async function destinationState() {
  const ids = [
    "patient-clickhouse",
    "linkage-clickhouse",
    "condition-clickhouse",
    "task-clickhouse",
  ];
  return Promise.all(
    ids.map(async (id) => {
      try {
        const response = await aidbox(
          `/fhir/AidboxTopicDestination/${id}/$status`,
        );
        const body = await response.json();
        return { id, ok: response.ok, status: body };
      } catch (error) {
        return { id, ok: false, status: { error: String(error) } };
      }
    }),
  );
}

export async function GET(request: Request) {
  try {
    const registryQuery = parseRegistryQuery(request.url);
    const [patients, linkages, conditions, tasks, analytics, destinations] =
      await Promise.all([
        resources("Patient"),
        resources("Linkage"),
        resources("Condition"),
        resources("Task"),
        analyticsState().catch((error) => ({ error: String(error) })),
        destinationState(),
      ]);

    const sourcePatients = patients.filter(
      (patient) => tag(patient, PATIENT_KIND_SYSTEM) === "source",
    );
    const clusters = linkages.filter(
      (linkage) =>
        profile(linkage, MDM_LINKAGE_PROFILE) && linkage.active === true,
    );
    const conditionLinkages = linkages.filter(
      (linkage) =>
        profile(linkage, MDM_CONDITION_LINKAGE_PROFILE) &&
        linkage.active === true,
    );
    const receiptTasks = tasks.filter(
      (task) =>
        task.status === "completed" &&
        (coding(task, OPERATION_CODE_SYSTEM, "source-commit") ||
          coding(task, OPERATION_CODE_SYSTEM, "link")) &&
        (task.identifier as Array<{ system?: string }> | undefined)?.some(
          (identifier) => identifier.system === MESSAGE_ID_SYSTEM,
        ),
    );
    const createTasks = receiptTasks.filter((task) =>
      ["A01", "A04"].includes(taskEvent(task) ?? ""),
    );
    const updateTasks = receiptTasks.filter(
      (task) => taskEvent(task) === "A08",
    );
    const clusterByMember = new Map<string, Resource>();
    for (const cluster of clusters) {
      for (const item of (cluster.item as Array<Record<string, unknown>>) ?? []) {
        if (item.type !== "alternate") continue;
        const member = reference(item.resource);
        if (member) clusterByMember.set(member, cluster);
      }
    }
    const conditionLinkageByMember = new Map<string, Resource>();
    for (const linkage of conditionLinkages) {
      for (const item of (linkage.item as Array<Record<string, unknown>>) ?? []) {
        const member = reference(item.resource);
        if (member?.startsWith("Condition/")) {
          conditionLinkageByMember.set(member, linkage);
        }
      }
    }
    const goldenByCluster = new Map<string, Resource>(
      clusters.flatMap((cluster) => {
        const golden = (cluster.contained as Resource[] | undefined)?.find(
          (resource) =>
            resource.resourceType === "Patient" && resource.id === "golden",
        );
        return golden
          ? [[`Linkage/${cluster.id}`, golden] as const]
          : [];
      }),
    );

    const sourceByReference = new Map(
      sourcePatients.map((patient) => [
        `Patient/${patient.id}`,
        patient,
      ]),
    );
    const conditionsBySubject = new Map<string, Resource[]>();
    for (const condition of conditions) {
      const subject = reference(condition.subject);
      if (!subject) continue;
      const subjectConditions = conditionsBySubject.get(subject) ?? [];
      subjectConditions.push(condition);
      conditionsBySubject.set(subject, subjectConditions);
    }
    const conditionsForMembers = (members: string[]) => {
      const sourceConditions = members.flatMap(
        (member) => conditionsBySubject.get(member) ?? [],
      );
      const groups = new Map<
        string,
        {
          id: string;
          kind: "linked" | "singleton";
          reference: string;
          evidence: ReturnType<typeof conditionSummary>[];
        }
      >();
      for (const condition of sourceConditions) {
        const conditionReference = `Condition/${condition.id}`;
        const linkage = conditionLinkageByMember.get(conditionReference);
        const groupReference = linkage
          ? `Linkage/${linkage.id}`
          : conditionReference;
        const group = groups.get(groupReference) ?? {
          id: linkage?.id ?? condition.id,
          kind: linkage ? "linked" : "singleton",
          reference: groupReference,
          evidence: [],
        };
        group.evidence.push(conditionSummary(condition));
        groups.set(groupReference, group);
      }
      const uniqueConditions = [...groups.values()]
        .map((group) => {
          const evidence = [...group.evidence].sort((left, right) =>
            String(left.source).localeCompare(String(right.source)),
          );
          const representative = evidence[0]!;
          return {
            ...group,
            system: representative.system,
            code: representative.code,
            display: representative.display,
            onset: representative.onset,
            evidence,
          };
        })
        .sort((left, right) =>
          String(left.display).localeCompare(String(right.display), "en"),
        );
      return {
        totalConditionCount: sourceConditions.length,
        uniqueConditionCount: uniqueConditions.length,
        duplicateConditionCount:
          sourceConditions.length - uniqueConditions.length,
        conditions: uniqueConditions,
      };
    };
    const patientCards = [
      ...clusters.flatMap((cluster) => {
        const clusterReference = `Linkage/${cluster.id}`;
        const golden = goldenByCluster.get(clusterReference);
        if (!golden) return [];
        const sourceRecords = (
          (cluster.item as Array<Record<string, unknown>>) ?? []
        )
          .filter((item) => item.type === "alternate")
          .map((item) => reference(item.resource))
          .filter((member): member is string => Boolean(member))
          .map((member) => sourceByReference.get(member))
          .filter((patient): patient is Resource => Boolean(patient))
          .map(patientSummary);
        const conditionState = conditionsForMembers(
          sourceRecords.map((source) => `Patient/${source.id}`),
        );
        return [
          {
            id: cluster.id,
            kind: "golden" as const,
            reference: clusterReference,
            version: cluster.meta?.versionId ?? "—",
            patient: {
              ...patientSummary(golden),
              version: cluster.meta?.versionId ?? "—",
            },
            sources: sourceRecords,
            patientCount: sourceRecords.length,
            ...conditionState,
          },
        ];
      }),
      ...sourcePatients
        .filter(
          (patient) => !clusterByMember.has(`Patient/${patient.id}`),
        )
        .map((patient) => ({
          id: patient.id,
          kind: "singleton" as const,
          reference: `Patient/${patient.id}`,
          version: patient.meta?.versionId ?? "—",
          patient: patientSummary(patient),
          sources: [],
          patientCount: 1,
          ...conditionsForMembers([`Patient/${patient.id}`]),
        })),
    ].sort(
      (left, right) =>
        left.patient.name.localeCompare(right.patient.name, "en") ||
        left.reference.localeCompare(right.reference),
    );
    const registryPage = paginateRegistry(patientCards, registryQuery);

    const receipts = receiptTasks
      .map((task) => ({
        id: task.id,
        status: task.status,
        patient: reference(task.focus),
        key: (task.identifier as Array<{ value?: string }> | undefined)?.[0]
          ?.value,
        updatedAt: task.meta?.lastUpdated ?? null,
      }))
      .sort((left, right) =>
        String(right.updatedAt).localeCompare(String(left.updatedAt)),
      )
      .slice(0, 12);

    return Response.json({
      generatedAt: new Date().toISOString(),
      aidbox: {
        sources: sourcePatients.length,
        goldens: goldenByCluster.size,
        clusters: clusters.length,
        memberships: [...clusterByMember.keys()].length,
        pending: 0,
        receipts: receiptTasks.length,
        creates: createTasks.length,
        updates: updateTasks.length,
        conditions: conditions.length,
        uniqueConditions:
          conditions.length -
          conditionLinkageByMember.size +
          conditionLinkages.length,
        conditionLinkages: conditionLinkages.length,
      },
      analytics,
      destinations,
      ...registryPage,
      receipts,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
