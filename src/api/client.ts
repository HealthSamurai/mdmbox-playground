import { makeClient as makeMdmboxClient } from "mdmbox-sdk";
import type {
  PatientRow,
  PatientFullInfo,
  GetPatientsFilter,
  MergeTaskRow,
  MergeDetail,
  GetMergesFilter,
  ProvenanceEntity,
  MergeStatus,
} from "./types";

export const mdmbox = makeMdmboxClient({ baseUrl: window.location.origin });

// ==================== Helpers ====================

function unwrap<T>(result: { isErr(): boolean; value: any }): T {
  if (result.isErr()) {
    const outcome = result.value?.resource;
    const msg =
      outcome?.issue?.[0]?.details?.text ??
      outcome?.issue?.[0]?.diagnostics ??
      "Request failed";
    throw Object.assign(new Error(msg), { outcome });
  }
  return result.value;
}

async function fhirRead<T = any>(type: string, id: string): Promise<T> {
  const result = await mdmbox.read<T>({ resourceType: type, id });
  return unwrap<{ resource: T }>(result).resource;
}

async function fhirSearch(
  type: string,
  params: [string, string][]
): Promise<{ entries: any[]; total?: number }> {
  const result = await mdmbox.search<any>({ resourceType: type, params });
  const bundle = unwrap<{ resource: any }>(result).resource;
  return {
    entries: bundle.entry?.map((e: any) => e.resource) ?? [],
    total: bundle.total,
  };
}

async function fhirReadReference<T = any>(reference: string): Promise<T> {
  const result = await mdmbox.readReference<T>({ reference });
  return unwrap<{ resource: T }>(result).resource;
}

// ==================== Flatten ====================

function flattenPatient(p: any): PatientRow {
  const name = p.name?.[0];
  const address = p.address?.[0];
  const phone = p.telecom?.find((t: any) => t.system === "phone")?.value;
  const email = p.telecom?.find((t: any) => t.system === "email")?.value;
  return {
    id: p.id,
    firstname: name?.given?.[0],
    lastname: name?.family,
    birthdate: p.birthDate,
    gender: p.gender,
    phonenumber: phone,
    email,
    street: address?.line?.[0],
    city: address?.city,
    state: address?.state,
    zip: address?.postalCode,
    country: address?.country,
  };
}

// ==================== API ====================

export const api = {
  async getPatients(params: {
    page: number;
    count: number;
    filter: GetPatientsFilter;
  }): Promise<{ items: PatientRow[]; total: number }> {
    const { page, count, filter } = params;
    const searchParams: [string, string][] = [
      ["_count", String(count)],
      ["_page", String(page)],
      ["_total", "accurate"],
    ];
    if (filter.id) searchParams.push(["_id", filter.id]);
    if (filter.firstName) searchParams.push(["given", filter.firstName]);
    if (filter.lastName) searchParams.push(["family", filter.lastName]);
    if (filter.birthdate) searchParams.push(["birthdate", filter.birthdate]);
    if (filter.phone) searchParams.push(["phone", filter.phone]);
    if (filter.email) searchParams.push(["email", filter.email]);

    const { entries, total } = await fhirSearch("Patient", searchParams);
    return { items: entries.map(flattenPatient), total: total ?? entries.length };
  },

  async matchPatientById(
    id: string,
    params: {
      count?: number;
      model?: string;
      threshold?: number;
    } = {}
  ) {
    // The $match contract takes a FHIR Parameters body: only modelId,
    // threshold, and count (a result cap). Server-side pagination is gone —
    // we fetch up to `count` candidates and paginate client-side in the table.
    const result = await mdmbox.matchById({
      resourceType: "Patient",
      id,
      modelId: params.model,
      threshold: params.threshold,
      count: params.count,
    });
    return unwrap<{ resource: import("mdmbox-sdk").MatchResponse }>(result).resource;
  },

  async getModel(id: string) {
    const result = await mdmbox.getModel({ id });
    // The server returns thresholds as { certain, probable }; our local
    // MatchingModel type (in ./types) reflects that, unlike the SDK's.
    return unwrap<{ resource: import("./types").MatchingModel }>(result).resource;
  },

  // List all matching models. The SDK only exposes getModel(id), so hit the
  // collection endpoint directly. `resourceType` lets callers keep only the
  // models that target a given FHIR type (e.g. "Patient").
  async getModels(resourceType?: string) {
    const result = await mdmbox.request<import("./types").MatchingModel[]>("/api/models");
    const models = unwrap<{ resource: import("./types").MatchingModel[] }>(result).resource;
    return resourceType ? models.filter((m) => m.resource === resourceType) : models;
  },

  async getMergePair(params: { sourceId: string; targetId: string }) {
    const [source, target] = await Promise.all([
      fhirRead("Patient", params.sourceId),
      fhirRead("Patient", params.targetId),
    ]);
    return { sourcePatient: source, targetPatient: target };
  },

  async getMerges(params: {
    page: number;
    count: number;
    filter: GetMergesFilter;
  }): Promise<{ items: MergeTaskRow[]; total: number }> {
    const { page, count, filter } = params;
    const searchParams: [string, string][] = [
      ["code", "merge"],
      ["_count", String(count)],
      ["_page", String(page)],
      ["_sort", "-authored-on"],
      ["_total", "accurate"],
    ];
    if (filter.status) searchParams.push(["business-status", filter.status]);
    if (filter.source) searchParams.push(["subject", filter.source]);
    if (filter.target) searchParams.push(["focus", filter.target]);
    if (filter.startDate)
      searchParams.push(["authored-on", `ge${filter.startDate}`]);
    else if (filter.endDate)
      searchParams.push(["authored-on", `le${filter.endDate}`]);

    const { entries, total } = await fhirSearch("Task", searchParams);
    const items: MergeTaskRow[] = entries.map((t: any) => ({
      id: t.id,
      status: (t.businessStatus?.coding?.[0]?.code ?? "merged") as MergeStatus,
      source: t.for?.reference,
      target: t.focus?.reference,
      date: t.authoredOn,
    }));
    return { items, total: total ?? items.length };
  },

  async getUnmerges(params: {
    page: number;
    count: number;
    filter: GetMergesFilter;
  }): Promise<{ items: MergeTaskRow[]; total: number }> {
    const { page, count, filter } = params;
    const searchParams: [string, string][] = [
      ["code", "unmerge"],
      ["_count", String(count)],
      ["_page", String(page)],
      ["_sort", "-authored-on"],
      ["_total", "accurate"],
    ];
    if (filter.status) searchParams.push(["business-status", filter.status]);
    if (filter.source) searchParams.push(["subject", filter.source]);
    if (filter.target) searchParams.push(["focus", filter.target]);
    if (filter.startDate)
      searchParams.push(["authored-on", `ge${filter.startDate}`]);
    else if (filter.endDate)
      searchParams.push(["authored-on", `le${filter.endDate}`]);

    const { entries, total } = await fhirSearch("Task", searchParams);
    const items: MergeTaskRow[] = entries.map((t: any) => ({
      id: t.id,
      status: (t.businessStatus?.coding?.[0]?.code ?? "unmerged") as MergeStatus,
      source: t.for?.reference,
      target: t.focus?.reference,
      date: t.authoredOn,
    }));
    return { items, total: total ?? items.length };
  },

  async getMerge(id: string): Promise<MergeDetail> {
    const task = await fhirRead("Task", id);
    const { entries: provResults } = await fhirSearch("Provenance", [
      ["target", `Task/${id}`],
      ["_count", "1"],
    ]);
    const provenance: any = provResults[0];

    const entities: ProvenanceEntity[] = (provenance?.entity ?? []).map(
      (e: any) => ({
        role: e.role,
        what: e.what?.reference ?? "",
      })
    );

    const entityRefs = new Set(
      entities.map((e) => e.what.replace(/\/_history\/.+$/, ""))
    );
    const taskRef = `Task/${task.id}`;
    const targetRefs: string[] = (provenance?.target ?? [])
      .map((t: any) => t.reference as string)
      .filter(Boolean);
    const createdRefs = targetRefs.filter(
      (ref) => ref !== taskRef && !entityRefs.has(ref)
    );

    return { task, provenance, entities, createdRefs };
  },

  async readResource(reference: string) {
    return fhirReadReference(reference);
  },

  async readVersionedResource(reference: string) {
    return fhirReadReference(reference);
  },

  async buildUnmergePlan(detail: MergeDetail) {
    const task = detail.task;
    const sourceRef: string = task.for?.reference ?? "";
    const targetRef: string = task.focus?.reference ?? "";

    const entries: import("mdmbox-sdk").MergePlanEntry[] = [];

    for (const entity of detail.entities) {
      const ref = entity.what;
      const historyMatch = ref.match(/^(.+)\/_history\/(\d+)$/);
      if (!historyMatch) continue;

      const baseRef = historyMatch[1];
      const version = parseInt(historyMatch[2], 10);

      if (entity.role === "revision") {
        if (version < 1) continue;
        const prevResource = await this.readResource(`${baseRef}/_history/${version}`);
        entries.push({
          resource: prevResource,
          request: { method: "PUT", url: baseRef },
        });
      } else if (entity.role === "removal") {
        const removedResource: any = await this.readResource(ref);
        const { meta: _meta, ...rest } = removedResource;
        entries.push({
          resource: rest,
          request: { method: "PUT", url: baseRef },
        });
      }
    }

    for (const ref of detail.createdRefs) {
      const resource: any = await this.readResource(ref);
      const version = resource?.meta?.versionId;
      entries.push({
        request: {
          method: "DELETE",
          url: ref,
          ...(version ? { ifMatch: `W/"${version}"` } : {}),
        },
      });
    }

    return { source: sourceRef, target: targetRef, entries, taskId: task.id as string };
  },

  async unmergePreview(plan: { source: string; target: string; entries: import("mdmbox-sdk").MergePlanEntry[]; taskId: string }) {
    const result = await mdmbox.unmergePreview({
      task: `Task/${plan.taskId}`,
      entries: plan.entries,
    });
    return unwrap<import("mdmbox-sdk").UnmergePreviewResponse>(result);
  },

  async unmerge(plan: { source: string; target: string; entries: import("mdmbox-sdk").MergePlanEntry[]; taskId: string }) {
    const result = await mdmbox.unmerge({
      task: `Task/${plan.taskId}`,
      entries: plan.entries,
    });
    return unwrap<import("mdmbox-sdk").UnmergeResponse>(result);
  },

  async getPatientSummary(id: string): Promise<PatientFullInfo> {
    const patient: any = await fhirRead("Patient", id);
    return {
      summary: {
        id: patient.id,
        givenNames: patient.name?.[0]?.given ?? [],
        family: patient.name?.[0]?.family ?? "",
        birthDate: patient.birthDate ?? "",
        gender: patient.gender ?? "unknown",
        street: patient.address?.[0]?.line?.[0],
        city: patient.address?.[0]?.city,
        state: patient.address?.[0]?.state,
        zip: patient.address?.[0]?.postalCode,
        country: patient.address?.[0]?.country,
        phone: patient.telecom?.find((t: any) => t.system === "phone")?.value,
        email: patient.telecom?.find((t: any) => t.system === "email")?.value,
        createdAt: patient.meta?.lastUpdated ?? "",
      },
      mergeHistory: [],
    };
  },
};
