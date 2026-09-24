import type { FhirResource, MdmCommand } from "./command.ts";
export type { FhirResource, MdmCommand } from "./command.ts";

export type CommitBranch =
  | "insert-singleton"
  | "insert-create-cluster"
  | "insert-extend-cluster"
  | "update-singleton"
  | "update-cluster";

export type PlannerConfig = {
  aidboxUrl: string;
  aidboxUser: string;
  aidboxPassword: string;
  mdmboxUrl: string;
  matchingModel: string;
};

type BundleEntry = {
  request: {
    method: "POST" | "PUT";
    url: string;
    ifMatch?: string;
    ifNoneMatch?: string;
  };
  resource: FhirResource;
};

type TransactionBundle = {
  resourceType: "Bundle";
  type: "transaction";
  entry: BundleEntry[];
};

export type CommitPlan =
  | { kind: "committed" }
  | {
      kind: "transaction";
      branch: CommitBranch;
      expectedRevision: string;
      transaction: TransactionBundle;
    };

const linkageProfile =
  "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-linkage";
const conditionLinkageProfile =
  "https://mdm.health-samurai.io/fhir/StructureDefinition/mdm-condition-linkage";
const operationTaskCodeSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/operation-task-code";
const taskPayloadTypeSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/task-payload-type";
const patientKindSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/patient-kind";
const sourceSystemTag =
  "https://mdm.health-samurai.io/fhir/CodeSystem/source-system";
const conditionKindSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/condition-kind";
const revisionCodeSystem =
  "https://mdm.health-samurai.io/fhir/CodeSystem/coordination-state";
const messageIdSystem = "urn:interbox:message-id";
const revisionReference = "Basic/mdm-revision";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class MdmSendFailure extends Error {
  constructor(
    readonly failure: "permanent" | "transient",
    readonly errorKind: string,
    message: string,
  ) {
    super(message);
    this.name = "MdmSendFailure";
  }
}

function baseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function auth(config: PlannerConfig): string {
  return `Basic ${Buffer.from(
    `${config.aidboxUser}:${config.aidboxPassword}`,
  ).toString("base64")}`;
}

function headers(config: PlannerConfig): Record<string, string> {
  return {
    Authorization: auth(config),
    "Content-Type": "application/fhir+json",
    Accept: "application/fhir+json",
  };
}

function bodyText(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
}

function transientStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function planningRequest(
  config: PlannerConfig,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...headers(config), ...(init.headers ?? {}) },
      });
      const body = await readBody(response);
      if (response.ok) return body;
      const error = new HttpError(
        response.status,
        body,
        `${init.method ?? "GET"} ${url} returned ${response.status}: ${bodyText(body)}`,
      );
      if (!transientStatus(response.status)) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof HttpError && !transientStatus(error.status)) throw error;
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(100 * 2 ** attempt, 2_000)));
  }
  if (lastError instanceof HttpError) throw lastError;
  throw new MdmSendFailure(
    "transient",
    "destination_unreachable",
    lastError instanceof Error ? lastError.message : String(lastError),
  );
}

async function maybeRead(
  config: PlannerConfig,
  reference: string,
): Promise<FhirResource | undefined> {
  try {
    return (await planningRequest(
      config,
      `${baseUrl(config.aidboxUrl)}/fhir/${reference}`,
    )) as FhirResource;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return undefined;
    throw error;
  }
}

async function readRequired(
  config: PlannerConfig,
  reference: string,
): Promise<FhirResource> {
  const resource = await maybeRead(config, reference);
  if (!resource) throw new Error(`Required coordination resource ${reference} is missing`);
  return resource;
}

function version(resource: FhirResource, reference: string): string {
  const result = resource.meta?.versionId;
  if (!result) throw new Error(`${reference} has no meta.versionId`);
  return result;
}

function weakEtag(value: string): string {
  return `W/"${value}"`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cleanServerMeta(resource: FhirResource): FhirResource {
  const result = clone(resource);
  if (result.meta) {
    delete result.meta.versionId;
    delete result.meta.lastUpdated;
  }
  return result;
}

function tagCode(resource: FhirResource, system: string): string | undefined {
  return resource.meta?.tag?.find((tag) => tag.system === system)?.code;
}

function isSourcePatient(resource: FhirResource): boolean {
  return (
    resource.resourceType === "Patient" &&
    tagCode(resource, patientKindSystem) === "source"
  );
}

function isSourceCondition(resource: FhirResource): boolean {
  return (
    resource.resourceType === "Condition" &&
    tagCode(resource, conditionKindSystem) === "source"
  );
}

function alternateMembers(linkage: FhirResource): string[] {
  const items = linkage.item as
    | Array<{ type?: string; resource?: { reference?: string } }>
    | undefined;
  return [
    ...new Set(
      (items ?? [])
        .filter((item) => item.type === "alternate")
        .map((item) => item.resource?.reference)
        .filter((reference): reference is string =>
          Boolean(reference?.startsWith("Patient/")),
        ),
    ),
  ];
}

async function memberships(
  config: PlannerConfig,
  patientReference: string,
): Promise<FhirResource[]> {
  return (await searchResources(config, "Linkage", { item: patientReference, _profile: linkageProfile }))
    .filter(
      (resource): resource is FhirResource =>
        Boolean(
          resource &&
            resource.resourceType === "Linkage" &&
            resource.active !== false &&
            resource.meta?.profile?.includes(linkageProfile),
        ),
    );
}

async function certainPatientMatches(
  config: PlannerConfig,
  patient: FhirResource,
): Promise<FhirResource[]> {
  const parameters = {
    resourceType: "Parameters",
    parameter: [
      { name: "modelId", valueString: config.matchingModel },
      { name: "resource", resource: patient },
      { name: "onlyCertainMatches", valueBoolean: true },
      { name: "count", valueInteger: 1000 },
    ],
  };
  const bundle = (await planningRequest(
    config,
    `${baseUrl(config.mdmboxUrl)}/api/fhir/r4/Patient/$match`,
    { method: "POST", body: JSON.stringify(parameters) },
  )) as { total?: number; entry?: Array<{ resource?: FhirResource }> };
  if (!Number.isSafeInteger(bundle.total) || bundle.total !== (bundle.entry ?? []).length) {
    throw new Error("Patient candidate response is incomplete; manual review is required");
  }
  return (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter(
      (resource): resource is FhirResource =>
        Boolean(
          resource &&
            resource.id &&
            resource.id !== patient.id &&
            isSourcePatient(resource),
        ),
    );
}

function conditionSubject(
  condition: FhirResource,
): string | undefined {
  const subject = condition.subject as
    | { reference?: string; resourceType?: string; id?: string }
    | undefined;
  if (subject?.reference) return subject.reference;
  if (subject?.resourceType && subject.id) {
    return `${subject.resourceType}/${subject.id}`;
  }
  return undefined;
}

function conditionMembers(linkage: FhirResource): string[] {
  const items = linkage.item as
    | Array<{ type?: string; resource?: { reference?: string } }>
    | undefined;
  return [
    ...new Set(
      (items ?? [])
        .map((item) => item.resource?.reference)
        .filter((reference): reference is string =>
          Boolean(reference?.startsWith("Condition/")),
        ),
    ),
  ];
}

async function conditionMemberships(
  config: PlannerConfig,
  conditionReference: string,
): Promise<FhirResource[]> {
  return (await searchResources(config, "Linkage", { item: conditionReference, _profile: conditionLinkageProfile }))
    .filter(
      (resource): resource is FhirResource =>
        Boolean(
          resource &&
            resource.resourceType === "Linkage" &&
            resource.active !== false &&
            resource.meta?.profile?.includes(conditionLinkageProfile),
        ),
    );
}

async function searchResources(config: PlannerConfig, type: string, parameters: Record<string, string>): Promise<FhirResource[]> {
  const query = new URLSearchParams({ ...parameters, _count: "200" });
  const firstUrl = `${baseUrl(config.aidboxUrl)}/fhir/${type}?${query}`;
  let url = firstUrl;
  const result: FhirResource[] = [];
  const visited = new Set<string>();
  let page = 1;
  while (true) {
    if (visited.has(url) || new URL(url).origin !== new URL(firstUrl).origin) throw new Error("Invalid FHIR pagination link");
    visited.add(url);
    const bundle = await planningRequest(config, url) as { entry?: Array<{ resource: FhirResource }>; total?: number; link?: Array<{ relation: string; url: string }> };
    const entries = bundle.entry ?? [];
    result.push(...entries.map(entry => entry.resource));
    const next = bundle.link?.find(link => link.relation === "next");
    if (next) url = new URL(next.url, url).href;
    else if (typeof bundle.total === "number" && result.length < bundle.total) {
      query.set("_page", String(++page));
      url = `${baseUrl(config.aidboxUrl)}/fhir/${type}?${query}`;
    } else break;
    if (entries.length === 0) throw new Error(`${type} search is incomplete`);
  }
  return result;
}

export function conditionKey(condition: FhirResource): string | undefined {
  const coding = (condition.code as { coding?: Array<{ system?: string; code?: string }> } | undefined)?.coding?.[0];
  const onset = condition.onsetDateTime;
  if (!coding?.system || !coding.code || typeof onset !== "string" || !onset) return undefined;
  return JSON.stringify([coding.system, coding.code, onset]);
}

const sourcePriority: Record<string, number> = {
  registry: 0,
  hospital: 1,
  claims: 2,
  lab: 3,
  pharmacy: 4,
  payer: 5,
};

function dedupeArray(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function calculateGolden(sources: FhirResource[]): FhirResource {
  const ordered = [...sources].sort(
    (left, right) =>
      (sourcePriority[tagCode(left, sourceSystemTag) ?? ""] ?? 100) -
      (sourcePriority[tagCode(right, sourceSystemTag) ?? ""] ?? 100),
  );
  const first = (key: string): unknown =>
    ordered.find((resource) => resource[key] !== undefined)?.[key];
  const identifiers = dedupeArray(
    ordered.flatMap((resource) =>
      Array.isArray(resource.identifier) ? resource.identifier : [],
    ),
  );
  return {
    resourceType: "Patient",
    id: "golden",
    active: true,
    ...(identifiers.length ? { identifier: identifiers } : {}),
    ...(first("name") ? { name: clone(first("name")) } : {}),
    ...(first("gender") ? { gender: first("gender") } : {}),
    ...(first("birthDate") ? { birthDate: first("birthDate") } : {}),
    ...(first("address") ? { address: clone(first("address")) } : {}),
    ...(first("telecom") ? { telecom: clone(first("telecom")) } : {}),
  };
}

async function resourcesForMembers(
  config: PlannerConfig,
  references: string[],
  incoming: FhirResource,
): Promise<FhirResource[]> {
  return await Promise.all(
    references.map(async (reference) => {
      if (reference === `Patient/${incoming.id}`) return incoming;
      return await readRequired(config, reference);
    }),
  );
}

async function clusterId(references: string[]): Promise<string> {
  const bytes = new TextEncoder().encode([...references].sort().join("|"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `cluster-${hash.slice(0, 32)}`;
}

async function conditionClusterId(references: string[]): Promise<string> {
  const bytes = new TextEncoder().encode([...references].sort().join("|"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `condition-cluster-${hash.slice(0, 32)}`;
}

async function newLinkage(
  config: PlannerConfig,
  references: string[],
  incoming: FhirResource,
): Promise<FhirResource> {
  const members = [...new Set(references)].sort();
  const sources = await resourcesForMembers(config, members, incoming);
  return {
    resourceType: "Linkage",
    id: await clusterId(members),
    meta: { profile: [linkageProfile] },
    active: true,
    author: { reference: "Organization/interbox" },
    contained: [calculateGolden(sources)],
    item: [
      { type: "source", resource: { reference: "#golden" } },
      ...members.map((reference) => ({
        type: "alternate",
        resource: { reference },
      })),
    ],
  };
}

async function extendedLinkage(
  config: PlannerConfig,
  persisted: FhirResource,
  incoming: FhirResource,
): Promise<FhirResource> {
  const members = [
    ...new Set([...alternateMembers(persisted), `Patient/${incoming.id}`]),
  ].sort();
  const sources = await resourcesForMembers(config, members, incoming);
  const result = cleanServerMeta(persisted);
  result.contained = [calculateGolden(sources)];
  result.item = [
    { type: "source", resource: { reference: "#golden" } },
    ...members.map((reference) => ({
      type: "alternate",
      resource: { reference },
    })),
  ];
  return result;
}

async function newConditionLinkage(
  references: string[],
): Promise<FhirResource> {
  const members = [...new Set(references)].sort();
  const [source, ...alternates] = members;
  if (!source || alternates.length === 0) {
    throw new Error("A Condition Linkage requires at least two members");
  }
  return {
    resourceType: "Linkage",
    id: await conditionClusterId(members),
    meta: { profile: [conditionLinkageProfile] },
    active: true,
    author: { reference: "Organization/interbox" },
    item: [
      { type: "source", resource: { reference: source } },
      ...alternates.map((reference) => ({
        type: "alternate",
        resource: { reference },
      })),
    ],
  };
}

function extendedConditionLinkage(
  persisted: FhirResource,
  conditionReference: string,
): FhirResource {
  const result = cleanServerMeta(persisted);
  const items = clone(
    (result.item as Array<{
      type?: string;
      resource?: { reference?: string };
    }> | undefined) ?? [],
  );
  if (
    !items.some(
      (item) => item.resource?.reference === conditionReference,
    )
  ) {
    items.push({
      type: "alternate",
      resource: { reference: conditionReference },
    });
  }
  result.item = items;
  return result;
}

function assertLinkageInvariants(linkage: FhirResource): void {
  const members = alternateMembers(linkage);
  const items = linkage.item as
    | Array<{ type?: string; resource?: { reference?: string } }>
    | undefined;
  const sourceItems = (items ?? []).filter(
    (item) => item.type === "source" && item.resource?.reference === "#golden",
  );
  const golden = (
    linkage.contained as FhirResource[] | undefined
  )?.filter(
    (resource) =>
      resource.resourceType === "Patient" && resource.id === "golden",
  );
  if (
    linkage.active !== true ||
    !linkage.meta?.profile?.includes(linkageProfile) ||
    sourceItems.length !== 1 ||
    (items ?? []).length !== sourceItems.length + members.length ||
    (linkage.contained as FhirResource[] | undefined)?.length !== 1 ||
    golden?.length !== 1 ||
    members.length < 2 ||
    members.length !==
      (items ?? []).filter((item) => item.type === "alternate").length
  ) {
    throw new Error(
      `Linkage/${linkage.id ?? "?"} violates the Interbox cluster invariants`,
    );
  }
}

function assertConditionLinkageInvariants(linkage: FhirResource): void {
  const members = conditionMembers(linkage);
  const items = linkage.item as
    | Array<{ type?: string; resource?: { reference?: string } }>
    | undefined;
  const sourceItems = (items ?? []).filter(
    (item) =>
      item.type === "source" &&
      item.resource?.reference?.startsWith("Condition/"),
  );
  if (
    linkage.active !== true ||
    !linkage.meta?.profile?.includes(conditionLinkageProfile) ||
    sourceItems.length !== 1 ||
    members.length < 2 ||
    members.length !== (items ?? []).length
  ) {
    throw new Error(
      `Linkage/${linkage.id ?? "?"} violates the Condition equivalence invariants`,
    );
  }
}

function taskPayload(
  code: string,
  value: {
    valueReference?: { reference: string };
    valueString?: string;
    valueCode?: string;
    valueInteger?: number;
  },
) {
  return {
    type: { coding: [{ system: taskPayloadTypeSystem, code }] },
    ...value,
  };
}

function operationTask(
  command: MdmCommand,
  branch: CommitBranch,
  clusterReference?: string,
): FhirResource {
  const patientReference = `Patient/${command.patient.id}`;
  const operation = branch.includes("cluster") && branch.startsWith("insert")
    ? "link"
    : "source-commit";
  return {
    resourceType: "Task",
    id: command.messageId,
    identifier: [{ system: messageIdSystem, value: command.messageId }],
    status: "completed",
    intent: "order",
    code: {
      coding: [{ system: operationTaskCodeSystem, code: operation }],
    },
    focus: { reference: patientReference },
    reasonCode: {
      text: `Interbox committed the ${branch} plan`,
    },
    authoredOn: new Date().toISOString(),
    input: [
      taskPayload("record", {
        valueReference: { reference: patientReference },
      }),
      clusterReference
        ? taskPayload("cluster", {
            valueReference: { reference: clusterReference },
          })
        : taskPayload("message-id", { valueString: command.messageId }),
      taskPayload("event", { valueCode: command.event }),
      taskPayload("cas-replan-count", {
        valueInteger: command.casReplanCount ?? 0,
      }),
    ],
    output: [
      taskPayload("record", {
        valueReference: { reference: patientReference },
      }),
      ...(clusterReference
        ? [
            taskPayload("cluster", {
              valueReference: { reference: clusterReference },
            }),
          ]
        : []),
    ],
  };
}

function provenance(
  command: MdmCommand,
  targets: string[],
): FhirResource {
  return {
    resourceType: "Provenance",
    recorded: new Date().toISOString(),
    activity: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/iso-21089-lifecycle",
          code: "amend",
        },
      ],
    },
    target: [
      { reference: `Task/${command.messageId}` },
      ...targets.map((reference) => ({ reference })),
      { reference: revisionReference },
    ],
    agent: [
      {
        type: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
              code: "author",
            },
          ],
        },
        who: { reference: "Device/interbox" },
      },
    ],
  };
}

function revisionEntry(
  messageId: string,
  expectedRevision: string,
): BundleEntry {
  return {
    request: {
      method: "PUT",
      url: revisionReference,
      ifMatch: weakEtag(expectedRevision),
    },
    resource: {
      resourceType: "Basic",
      id: "mdm-revision",
      code: {
        coding: [
          { system: revisionCodeSystem, code: "mdm-coordination-state" },
        ],
      },
      subject: { reference: `Task/${messageId}` },
      author: { reference: "Organization/interbox" },
    },
  };
}

type PlanningBase = {
  config: PlannerConfig;
  command: MdmCommand;
  patientReference: string;
};

type Coordinated = PlanningBase & {
  expectedRevision: string;
};

type PlanningState =
  | (PlanningBase & { stage: "received" })
  | (PlanningBase & { stage: "committed" })
  | (Coordinated & { stage: "classified" })
  | (Coordinated & { stage: "insert" })
  | (Coordinated & { stage: "update"; persistedPatient: FhirResource })
  | (Coordinated & { stage: "insert-singleton" })
  | (Coordinated & {
      stage: "insert-create-cluster";
      linkage: FhirResource;
    })
  | (Coordinated & {
      stage: "insert-extend-cluster";
      persistedLinkage: FhirResource;
      linkage: FhirResource;
    })
  | (Coordinated & {
      stage: "update-singleton";
      persistedPatient: FhirResource;
    })
  | (Coordinated & {
      stage: "update-cluster";
      persistedPatient: FhirResource;
      persistedLinkage: FhirResource;
      linkage: FhirResource;
    })
  | (PlanningBase & { stage: "planned"; plan: CommitPlan });

type PlanningStep = (state: PlanningState) => Promise<PlanningState>;

function atomicTransaction(
  command: MdmCommand,
  expectedRevision: string,
  branch: CommitBranch,
  patientRequest: BundleEntry["request"],
  linkage?: {
    request: BundleEntry["request"];
    resource: FhirResource;
  },
): CommitPlan {
  if (linkage) assertLinkageInvariants(linkage.resource);
  const patientReference = `Patient/${command.patient.id}`;
  const clusterReference = linkage
    ? `Linkage/${linkage.resource.id}`
    : undefined;
  const targets = [
    patientReference,
    ...(clusterReference ? [clusterReference] : []),
  ];
  return {
    kind: "transaction",
    branch,
    expectedRevision,
    transaction: {
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        revisionEntry(command.messageId, expectedRevision),
        {
          request: {
            method: "PUT",
            url: `Task/${command.messageId}`,
            ifNoneMatch: "*",
          },
          resource: operationTask(command, branch, clusterReference),
        },
        {
          request: { method: "POST", url: "Provenance" },
          resource: provenance(command, targets),
        },
        {
          request: patientRequest,
          resource: command.patient,
        },
        ...(linkage
          ? [{ request: linkage.request, resource: linkage.resource }]
          : []),
      ],
    },
  };
}

function plannedPatientScope(
  command: MdmCommand,
  plan: Extract<CommitPlan, { kind: "transaction" }>,
): Set<string> {
  const patientLinkage = plan.transaction.entry
    .map((entry) => entry.resource)
    .find(
      (resource) =>
        resource.resourceType === "Linkage" &&
        resource.meta?.profile?.includes(linkageProfile),
    );
  return new Set(
    patientLinkage
      ? alternateMembers(patientLinkage)
      : [`Patient/${command.patient.id}`],
  );
}

async function planConditionEntries(
  config: PlannerConfig,
  command: MdmCommand,
  patientScope: Set<string>,
): Promise<{ entries: BundleEntry[]; targets: string[] }> {
  const conditions = command.conditions ?? [];
  if (conditions.length === 0) return { entries: [], targets: [] };
  const patientReference = `Patient/${command.patient.id}`;
  const ids = new Set<string>();
  for (const condition of conditions) {
    if (ids.has(condition.id)) throw new Error(`Condition/${condition.id} occurs more than once in one command`);
    ids.add(condition.id);
    if (conditionSubject(condition) !== patientReference) throw new Error(`Condition/${condition.id} must reference the command Patient as subject`);
  }

  const stored = (await Promise.all([...patientScope].sort().map(subject =>
    searchResources(config, "Condition", { subject }),
  ))).flat().filter(resource => isSourceCondition(resource) && patientScope.has(conditionSubject(resource) ?? ""));
  const candidates = new Map(stored.map(resource => [resource.id!, resource]));
  for (const condition of conditions) candidates.set(condition.id, condition);
  const entries: BundleEntry[] = [];
  const handledKeys = new Set<string>();

  for (const condition of conditions) {
    const reference = `Condition/${condition.id}`;
    const persisted = await maybeRead(config, reference);
    if (persisted && conditionKey(persisted) !== conditionKey(condition)) {
      const memberships = await conditionMemberships(config, reference);
      if (memberships.length > 0) throw new Error(`Changing the equivalence key of linked ${reference} requires manual review`);
    }
    entries.push({
      request: persisted
        ? { method: "PUT", url: reference, ifMatch: weakEtag(version(persisted, reference)) }
        : { method: "PUT", url: reference, ifNoneMatch: "*" },
      resource: condition,
    });

    const key = conditionKey(condition);
    if (!key || handledKeys.has(key)) continue;
    handledKeys.add(key);
    const matches = [...candidates.values()].filter(resource => conditionKey(resource) === key);
    if (matches.length < 2) continue;
    const memberRefs = matches.map(resource => `Condition/${resource.id}`).sort();
    const current = new Map<string, FhirResource>();
    for (const member of memberRefs) {
      const memberships = await conditionMemberships(config, member);
      if (memberships.length > 1) throw new Error(`${member} belongs to multiple active Condition Linkages`);
      for (const linkage of memberships) current.set(linkage.id!, linkage);
    }
    if (current.size > 1) throw new Error("Condition matches span multiple equivalence groups; manual review is required");
    const existing = [...current.values()][0];
    let linkage = existing;
    if (linkage) {
      if (memberRefs.every(member => conditionMembers(linkage!).includes(member))) continue;
      for (const member of memberRefs) linkage = extendedConditionLinkage(linkage, member);
    } else linkage = await newConditionLinkage(memberRefs);
    assertConditionLinkageInvariants(linkage);
    const linkageRef = `Linkage/${linkage.id}`;
    entries.push({
      request: existing
        ? { method: "PUT", url: linkageRef, ifMatch: weakEtag(version(existing, linkageRef)) }
        : { method: "PUT", url: linkageRef, ifNoneMatch: "*" },
      resource: linkage,
    });
  }
  return { entries, targets: entries.map(entry => entry.request.url) };
}
async function appendConditionPlan(
  config: PlannerConfig,
  command: MdmCommand,
  plan: CommitPlan,
): Promise<CommitPlan> {
  if (plan.kind !== "transaction" || !command.conditions?.length) return plan;
  const conditionPlan = await planConditionEntries(
    config,
    command,
    plannedPatientScope(command, plan),
  );
  const task = plan.transaction.entry
    .map((entry) => entry.resource)
    .find((resource) => resource.resourceType === "Task");
  if (task) {
    const input = (
      task.input as Array<Record<string, unknown>> | undefined
    ) ?? [];
    input.push(
      taskPayload("condition-count", {
        valueInteger: command.conditions.length,
      }),
    );
    task.input = input;
  }
  const provenance = plan.transaction.entry
    .map((entry) => entry.resource)
    .find((resource) => resource.resourceType === "Provenance");
  if (provenance) {
    const targets = (
      provenance.target as Array<{ reference: string }> | undefined
    ) ?? [];
    const known = new Set(targets.map((target) => target.reference));
    for (const reference of conditionPlan.targets) {
      if (!known.has(reference)) targets.push({ reference });
    }
    provenance.target = targets;
  }
  plan.transaction.entry.push(...conditionPlan.entries);
  return plan;
}

const checkIdempotency: PlanningStep = async (state) => {
  if (state.stage !== "received") return state;
  const revision = await readRequired(state.config, revisionReference);
  const expectedRevision = version(revision, revisionReference);
  if (
    await maybeRead(
      state.config,
      `Task/${state.command.messageId}`,
    )
  ) {
    return { ...state, stage: "committed" };
  }
  return { ...state, stage: "classified", expectedRevision };
};

const classifyInsertOrUpdate: PlanningStep = async (state) => {
  if (state.stage !== "classified") return state;
  const persistedPatient = await maybeRead(
    state.config,
    state.patientReference,
  );
  if (persistedPatient) {
    return { ...state, stage: "update", persistedPatient };
  }
  if (state.command.event === "A08") {
    throw new Error(
      `ADT^A08 cannot update missing source ${state.patientReference}`,
    );
  }
  return { ...state, stage: "insert" };
};

const classifySingletonOrCluster: PlanningStep = async (state) => {
  if (state.stage === "update") {
    const activeMemberships = await memberships(
      state.config,
      state.patientReference,
    );
    if (activeMemberships.length > 1) {
      throw new Error(
        `${state.patientReference} belongs to multiple active Linkages`,
      );
    }
    const persistedLinkage = activeMemberships[0];
    if (!persistedLinkage) {
      return { ...state, stage: "update-singleton" };
    }
    const linkage = await extendedLinkage(
      state.config,
      persistedLinkage,
      state.command.patient,
    );
    return {
      ...state,
      stage: "update-cluster",
      persistedLinkage,
      linkage,
    };
  }

  if (state.stage !== "insert") return state;
  const matches = await certainPatientMatches(
    state.config,
    state.command.patient,
  );
  if (matches.length === 0) {
    return { ...state, stage: "insert-singleton" };
  }
  const resolvedMatches = await Promise.all(
    matches.map(async (match) => {
      const reference = `Patient/${match.id}`;
      const activeMemberships = await memberships(state.config, reference);
      if (activeMemberships.length > 1) {
        throw new Error(`${reference} belongs to multiple active Linkages`);
      }
      return { reference, linkage: activeMemberships[0] };
    }),
  );
  const byCluster = new Map<string, FhirResource>();
  const standalone: string[] = [];
  for (const match of resolvedMatches) {
    if (match.linkage?.id) {
      byCluster.set(match.linkage.id, match.linkage);
    } else {
      standalone.push(match.reference);
    }
  }
  if (byCluster.size > 1 || (byCluster.size === 1 && standalone.length > 0)) {
    throw new Error(
      "Certain matches span more than one current cluster; manual review is required",
    );
  }
  if (byCluster.size === 1) {
    const persistedLinkage = [...byCluster.values()][0]!;
    const linkage = await extendedLinkage(
      state.config,
      persistedLinkage,
      state.command.patient,
    );
    return {
      ...state,
      stage: "insert-extend-cluster",
      persistedLinkage,
      linkage,
    };
  }
  const linkage = await newLinkage(
    state.config,
    [...standalone, state.patientReference],
    state.command.patient,
  );
  return { ...state, stage: "insert-create-cluster", linkage };
};

const buildAtomicCommit: PlanningStep = async (state) => {
  switch (state.stage) {
    case "insert-singleton":
      return {
        ...state,
        stage: "planned",
        plan: atomicTransaction(
          state.command,
          state.expectedRevision,
          state.stage,
          {
            method: "PUT",
            url: state.patientReference,
            ifNoneMatch: "*",
          },
        ),
      };
    case "insert-create-cluster":
      return {
        ...state,
        stage: "planned",
        plan: atomicTransaction(
          state.command,
          state.expectedRevision,
          state.stage,
          {
            method: "PUT",
            url: state.patientReference,
            ifNoneMatch: "*",
          },
          {
            request: {
              method: "PUT",
              url: `Linkage/${state.linkage.id}`,
              ifNoneMatch: "*",
            },
            resource: state.linkage,
          },
        ),
      };
    case "insert-extend-cluster":
      return {
        ...state,
        stage: "planned",
        plan: atomicTransaction(
          state.command,
          state.expectedRevision,
          state.stage,
          {
            method: "PUT",
            url: state.patientReference,
            ifNoneMatch: "*",
          },
          {
            request: {
              method: "PUT",
              url: `Linkage/${state.linkage.id}`,
              ifMatch: weakEtag(
                version(
                  state.persistedLinkage,
                  `Linkage/${state.persistedLinkage.id}`,
                ),
              ),
            },
            resource: state.linkage,
          },
        ),
      };
    case "update-singleton":
      return {
        ...state,
        stage: "planned",
        plan: atomicTransaction(
          state.command,
          state.expectedRevision,
          state.stage,
          {
            method: "PUT",
            url: state.patientReference,
            ifMatch: weakEtag(
              version(state.persistedPatient, state.patientReference),
            ),
          },
        ),
      };
    case "update-cluster":
      return {
        ...state,
        stage: "planned",
        plan: atomicTransaction(
          state.command,
          state.expectedRevision,
          state.stage,
          {
            method: "PUT",
            url: state.patientReference,
            ifMatch: weakEtag(
              version(state.persistedPatient, state.patientReference),
            ),
          },
          {
            request: {
              method: "PUT",
              url: `Linkage/${state.linkage.id}`,
              ifMatch: weakEtag(
                version(
                  state.persistedLinkage,
                  `Linkage/${state.persistedLinkage.id}`,
                ),
              ),
            },
            resource: state.linkage,
          },
        ),
      };
    default:
      return state;
  }
};

const planningPipeline: PlanningStep[] = [
  checkIdempotency,
  classifyInsertOrUpdate,
  classifySingletonOrCluster,
  buildAtomicCommit,
];

async function runPlanningPipeline(
  initial: PlanningState,
): Promise<PlanningState> {
  let state = initial;
  for (const step of planningPipeline) {
    state = await step(state);
  }
  return state;
}

export async function planMdmCommand(
  config: PlannerConfig,
  command: MdmCommand,
): Promise<CommitPlan> {
  const finalState = await runPlanningPipeline({
    stage: "received",
    config,
    command,
    patientReference: `Patient/${command.patient.id}`,
  });
  if (finalState.stage === "committed") return { kind: "committed" };
  if (finalState.stage === "planned") {
    return await appendConditionPlan(config, command, finalState.plan);
  }
  throw new Error(`MDM planning stopped at unexpected stage ${finalState.stage}`);
}
