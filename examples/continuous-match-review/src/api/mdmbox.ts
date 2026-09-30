import { ApiError, request } from "./http";
import type { Bundle, OperationOutcome, Parameters, ParametersParameter, Patient, Task } from "./fhir";
import { reference } from "./fhir";

// ==================== Continuous matching ====================

/**
 * Decision evaluated by MDMbox at request time from merge and not-a-match Tasks. MDMbox also reports
 * `linked` for pairs linked with `$link`, which this app doesn't do.
 */
export type DecisionStatus = "pending" | "merged" | "not-a-match";

export const DECISION_STATUSES: DecisionStatus[] = ["pending", "merged", "not-a-match"];

/** One scored pair of the accumulated results. Ids are ordered: resourceId1 < resourceId2. */
export type MatchPair = {
  resourceId1: string;
  resourceId2: string;
  matchWeight: number;
  /** Weight each model feature contributed, e.g. `{ "family": 10, "birth_date": -6 }` */
  matchDetails: Record<string, number>;
  decisionStatus: DecisionStatus;
};

export type PairsPage = {
  entries: MatchPair[];
  /** Pairs matching the filter on all pages. */
  total: number;
};

export type ProcessState = "idle" | "building" | "running" | "pausing" | "paused" | "failed";

export type ProcessStatus = {
  status: ProcessState;
  stage?: string;
  error?: string;
  /** Model version the process runs with, and the latest saved version. */
  modelVersion?: string;
  currentModelVersion?: string;
  modelChanged: boolean;
  /** Accumulated pairs, whatever their decision. */
  pairs: number;
  errors: number;
  batches: { pending: number; running: number; completed: number; failed: number; total: number };
  /** Inserted records that are not assigned to a batch yet. */
  waitingRecords: number;
  statusChangedAt?: string;
};

const processUrl = (modelId: string) => `/api/continuous-match/${encodeURIComponent(modelId)}`;

/**
 * One page of the accumulated pairs, strongest match first; equal weights are ordered by resource ids.
 *
 * `GET /api/continuous-match/{model}/result` with `Accept: application/json` returns `{ entries, total }`.
 * `_count` is the page size (up to 1000), `_page` is zero-based, and `decisionStatus` filters by the
 * decision evaluated at request time. Every request reads the live results, so pairs shift between pages
 * as MDMbox finds pairs and decisions are made. Other Accept values export all pairs as NDJSON or CSV.
 */
export async function getPairs(
  modelId: string,
  { page, count, decisionStatus }: { page: number; count: number; decisionStatus?: DecisionStatus },
): Promise<PairsPage> {
  const query = new URLSearchParams({ _count: String(count), _page: String(page) });
  if (decisionStatus) query.set("decisionStatus", decisionStatus);
  try {
    return await request<PairsPage>(`${processUrl(modelId)}/result?${query}`, { accept: "application/json" });
  } catch (e) {
    if (e instanceof ApiError && e.status === 406) {
      throw new ApiError("This MDMbox version can't return continuous matching results as JSON pages. Upgrade MDMbox.", 406, e.outcome);
    }
    throw e;
  }
}

/** Number of pairs with the given decision: `_count=0` returns only the total. */
export async function countPairs(modelId: string, decisionStatus?: DecisionStatus): Promise<number> {
  return (await getPairs(modelId, { page: 0, count: 0, decisionStatus })).total;
}

/** Process state and counters as FHIR Parameters; `null` when the model has no process yet. */
export async function getProcessStatus(modelId: string): Promise<ProcessStatus | null> {
  try {
    return readStatus(await request<Parameters>(`${processUrl(modelId)}/status`));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

function readStatus(params: Parameters): ProcessStatus {
  const get = (name: string, from = params.parameter) => from?.find((p) => p.name === name);
  const count = (p?: ParametersParameter) => p?.valueDecimal ?? p?.valueInteger ?? 0;
  const progress = get("progress")?.part;
  return {
    status: get("status")?.valueCode as ProcessState,
    stage: get("stage")?.valueCode,
    error: get("error")?.valueString,
    modelVersion: get("modelVersion")?.valueString,
    currentModelVersion: get("currentModelVersion")?.valueString,
    modelChanged: get("modelChanged")?.valueBoolean ?? false,
    pairs: count(get("pairs")),
    errors: count(get("errors")),
    batches: {
      pending: count(get("pending", progress)),
      running: count(get("running", progress)),
      completed: count(get("completed", progress)),
      failed: count(get("failed", progress)),
      total: count(get("total", progress)),
    },
    waitingRecords: count(get("unassigned", get("projection")?.part)),
    statusChangedAt: get("statusChangedAt")?.valueDateTime,
  };
}

/** Prepares the data, matches the existing records, then keeps matching new inserts. */
export async function startProcess(modelId: string): Promise<void> {
  await request(`${processUrl(modelId)}/start`, { method: "POST", body: {} });
}

// ==================== Decisions ====================

/** Resource types whose references to the merged-away patient are moved to the surviving one. */
export const RELATED_RESOURCE_TYPES = [
  "Encounter",
  "Observation",
  "Condition",
  "Procedure",
  "MedicationRequest",
  "AllergyIntolerance",
  "Immunization",
  "DiagnosticReport",
  "DocumentReference",
];

export type MergeResponse = {
  /** Merge Task of an executed merge; keep it to $unmerge later. */
  task?: Task;
  /** Transaction Bundle a preview would execute. */
  plan?: Bundle;
  outcome?: OperationOutcome;
};

/**
 * Server-managed `$merge/v2` with MDMbox's built-in `simple` algorithm: the target becomes `result`,
 * references from the related resource types move from the source to the target, and the source is
 * deleted. MDMbox records Task and Provenance, so the merge can be undone with `$unmerge/v2`.
 * `preview` returns the plan without writing anything.
 */
export async function mergePatients(input: {
  sourceId: string;
  targetId: string;
  result: Patient;
  preview: boolean;
}): Promise<MergeResponse> {
  const parameter: ParametersParameter[] = [
    { name: "source", valueReference: { reference: reference("Patient", input.sourceId) } },
    { name: "target", valueReference: { reference: reference("Patient", input.targetId) } },
    { name: "result", resource: input.result },
    ...RELATED_RESOURCE_TYPES.map((type) => ({ name: "related-resource-type", valueString: type })),
    { name: "preview", valueBoolean: input.preview },
  ];
  const response = await request<Parameters>("/api/fhir/$merge/v2", {
    method: "POST",
    body: { resourceType: "Parameters", parameter },
  });
  const resource = (name: string) => response.parameter?.find((p) => p.name === name)?.resource;
  return {
    task: resource("task") as Task | undefined,
    plan: resource("plan") as Bundle | undefined,
    outcome: resource("outcome") as OperationOutcome | undefined,
  };
}

/** Records that the two patients are different people: MDMbox then refuses to link or merge them. */
export async function markNotAMatch(id1: string, id2: string, note?: string): Promise<void> {
  const parameter: ParametersParameter[] = [
    { name: "record", valueReference: { reference: reference("Patient", id1) } },
    { name: "record", valueReference: { reference: reference("Patient", id2) } },
  ];
  if (note) parameter.push({ name: "note", valueString: note });
  await request("/api/fhir/$mark-not-a-match", {
    method: "POST",
    body: { resourceType: "Parameters", parameter },
  });
}
