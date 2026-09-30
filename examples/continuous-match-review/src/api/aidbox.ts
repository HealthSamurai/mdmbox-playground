import { ApiError, request } from "./http";
import type { Bundle, Meta, Patient, Task } from "./fhir";

export type BulkMatchingModel = {
  resourceType: "BulkMatchingModel";
  id: string;
  meta?: Meta;
  resource: string;
  thresholds?: { certain?: number; probable?: number };
  feature?: { name: string; case: { expression?: string; weight?: number; else?: number }[] }[];
};

const resources = <T>(bundle: Bundle<T>): T[] => bundle.entry?.flatMap((e) => (e.resource ? [e.resource] : [])) ?? [];

/** BulkMatchingModels for Patient: each one can drive a continuous matching process. */
export async function listPatientModels(): Promise<BulkMatchingModel[]> {
  const bundle = await request<Bundle<BulkMatchingModel>>("/fhir/BulkMatchingModel?_count=100");
  return resources(bundle)
    .filter((model) => model.resource === "Patient")
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A process keeps the model version it started with, so read that version when it is known. */
export async function getModel(id: string, versionId?: string): Promise<BulkMatchingModel> {
  const url = `/fhir/BulkMatchingModel/${encodeURIComponent(id)}`;
  if (versionId) {
    try {
      return await request<BulkMatchingModel>(`${url}/_history/${encodeURIComponent(versionId)}`);
    } catch {
      // The version is gone from history: fall back to the current one.
    }
  }
  return request<BulkMatchingModel>(url);
}

/** Current versions of the patients; deleted ones (e.g. merged away) are absent. */
export async function getPatients(ids: string[]): Promise<Map<string, Patient>> {
  if (ids.length === 0) return new Map();
  const query = new URLSearchParams({ _id: ids.join(","), _count: String(ids.length) });
  const bundle = await request<Bundle<Patient>>(`/fhir/Patient?${query}`);
  return new Map(resources(bundle).map((patient) => [patient.id, patient]));
}

export type PatientRecord = { patient: Patient; deleted: boolean };

/** A patient, or the last version of a deleted one from its history; `null` if it never existed. */
export async function getPatientRecord(id: string): Promise<PatientRecord | null> {
  const url = `/fhir/Patient/${encodeURIComponent(id)}`;
  try {
    return { patient: await request<Patient>(url), deleted: false };
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 410)) throw e;
  }
  // History is newest first; the deletion itself may come without a resource.
  const history = await request<Bundle<Patient>>(`${url}/_history?_count=10`);
  const lastVersion = resources(history)[0];
  return lastVersion ? { patient: lastVersion, deleted: true } : null;
}

/** The merge that deleted `Patient/{id}`: Task.for is the merged-away source, Task.focus the survivor. */
export async function findMergeOf(id: string): Promise<Task | undefined> {
  const query = new URLSearchParams({ code: "merge", subject: `Patient/${id}`, _sort: "-_lastUpdated", _count: "1" });
  return resources(await request<Bundle<Task>>(`/fhir/Task?${query}`))[0];
}
