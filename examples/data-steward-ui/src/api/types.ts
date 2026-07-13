export type PatientRow = {
  id: string;
  firstname?: string;
  lastname?: string;
  phonenumber?: string;
  email?: string;
  birthdate?: string;
  gender?: "male" | "female" | "other" | "unknown";
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
};

export type PatientSummary = {
  id: string;
  givenNames: string[];
  family: string;
  birthDate: string;
  gender: "male" | "female" | "other" | "unknown";
  addressLines?: string[];
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  email?: string;
  createdAt: string;
  updatedAt?: string;
};

export type PatientMergeHistory = {
  id: string;
  status: string;
  user?: string;
  date?: string;
  sourcePatientId?: string;
  targetPatientId?: string;
};

export type PatientFullInfo = {
  summary: PatientSummary;
  mergeHistory: PatientMergeHistory[];
};

export type GetPatientsFilter = {
  id?: string;
  firstName?: string;
  lastName?: string;
  birthdate?: string;
  phone?: string;
  email?: string;
};

export type SearchParamsObj = {
  [key: string]: string | string[] | undefined;
};

export type { MatchResult, MatchResponse } from "mdmbox-sdk";
import type { MatchingModel as SdkMatchingModel } from "mdmbox-sdk";

/**
 * MatchingModel as returned by `GET /api/models/{id}`. The SDK's own type still
 * declares `thresholds?: { auto?; manual? }`, but the server now sends
 * `{ certain, probable }` — override the field so callers read the real keys.
 */
export type MatchingModel = Omit<SdkMatchingModel, "thresholds"> & {
  thresholds?: { certain?: number; probable?: number };
};

/**
 * Per-feature log-odds contributions returned by $match for each candidate.
 * Keys are model-defined and vary by matching model (e.g. `fn`/`dob`/`ext`/`sex`
 * for one model, `given`/`family`/`birth_date`/... for another).
 */
export type MatchDetails = Record<string, number>;

export type PatientMatchRow = {
  id: string;
  firstname: string;
  lastname: string;
  birthdate: string;
  email: string;
  gender: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  /** Raw log-odds weight (search.score). */
  weight?: number;
  /** Normalized match probability 0..1 (search.normalizedScore). */
  normalizedScore?: number;
  duplicate: boolean;
  matchDetails?: MatchDetails;
};

export type MergeStatus = "merged" | "unmerged";

export type MergeTaskRow = {
  id: string;
  status: MergeStatus;
  source?: string; // e.g. "Patient/123"
  target?: string; // e.g. "Patient/456"
  date?: string; // Task.authoredOn (ISO)
};

export type ProvenanceEntity = {
  role: "revision" | "removal" | string;
  /** versioned reference, e.g. "Patient/123/_history/2" */
  what: string;
};

export type MergeDetail = {
  task: Record<string, any>;
  provenance?: Record<string, any>;
  /** parsed from provenance.entity */
  entities: ProvenanceEntity[];
  /** parsed from provenance.target — references that were created (in target but not in entity) */
  createdRefs: string[];
};

export type GetMergesFilter = {
  status?: MergeStatus;
  source?: string;
  target?: string;
  startDate?: string; // ISO
  endDate?: string; // ISO
};
