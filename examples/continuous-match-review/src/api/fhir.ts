// The small subset of FHIR R4 used by this app.

export type Coding = { system?: string; code?: string; display?: string };
export type CodeableConcept = { coding?: Coding[]; text?: string };
export type Reference = { reference?: string; display?: string };

export type Identifier = {
  use?: string;
  type?: CodeableConcept;
  system?: string;
  value?: string;
};

export type HumanName = {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
};

export type ContactPoint = { system?: string; value?: string; use?: string; rank?: number };

export type Address = {
  use?: string;
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export type Meta = { versionId?: string; lastUpdated?: string };

export type Patient = {
  resourceType: "Patient";
  id: string;
  meta?: Meta;
  text?: unknown;
  identifier?: Identifier[];
  active?: boolean;
  name?: HumanName[];
  telecom?: ContactPoint[];
  gender?: string;
  birthDate?: string;
  address?: Address[];
  maritalStatus?: CodeableConcept;
  communication?: { language?: CodeableConcept; preferred?: boolean }[];
  [key: string]: unknown;
};

export type Task = {
  resourceType: "Task";
  id: string;
  status: string;
  businessStatus?: CodeableConcept;
  authoredOn?: string;
  for?: Reference;
  focus?: Reference;
};

export type BundleEntry<T> = {
  resource?: T;
  request?: { method: string; url: string };
};

export type Bundle<T = unknown> = {
  resourceType: "Bundle";
  type?: string;
  total?: number;
  entry?: BundleEntry<T>[];
};

export type OperationOutcome = {
  resourceType: "OperationOutcome";
  issue?: { severity?: string; code?: string; diagnostics?: string; details?: { text?: string } }[];
};

export type ParametersParameter = {
  name: string;
  part?: ParametersParameter[];
  resource?: unknown;
  valueBoolean?: boolean;
  valueCode?: string;
  valueDateTime?: string;
  valueDecimal?: number;
  valueInteger?: number;
  valueReference?: Reference;
  valueString?: string;
};

export type Parameters = { resourceType: "Parameters"; parameter?: ParametersParameter[] };

export const reference = (resourceType: string, id: string) => `${resourceType}/${id}`;
