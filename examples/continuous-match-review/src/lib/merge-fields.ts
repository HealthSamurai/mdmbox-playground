import type { CodeableConcept, Identifier, Patient } from "../api/fhir";

/** Index of a record in the reviewed pair. */
export type Side = 0 | 1;

/** An attribute the data steward takes from one record or the other. */
export type MergeField = {
  key: string;
  label: string;
  /** Displayed value; records differ on the field when these differ. */
  read: (patient: Patient) => string;
  /** Copies the attribute from `from` into the merge result, removing it when `from` has none. */
  copy: (result: Patient, from: Patient) => void;
};

type Path = (string | number)[];

function getIn(value: unknown, path: Path): unknown {
  return path.reduce<unknown>((node, key) => (node == null ? undefined : (node as Record<string | number, unknown>)[key]), value);
}

function setIn(target: Record<string, unknown>, path: Path, value: unknown): void {
  let node = target as Record<string | number, unknown>;
  path.slice(0, -1).forEach((key, i) => {
    node[key] ??= typeof path[i + 1] === "number" ? [] : {};
    node = node[key] as Record<string | number, unknown>;
  });
  // An absent value leaves a hole that `prune` removes.
  node[path[path.length - 1]] = value === undefined ? undefined : structuredClone(value);
}

const text = (value: unknown) => (value == null ? "" : String(value));

const conceptText = (concept?: CodeableConcept) => concept?.text ?? concept?.coding?.[0]?.display ?? concept?.coding?.[0]?.code;

/** A value at a fixed path, e.g. the first given name. */
const at = (key: string, label: string, path: Path, read = (value: unknown) => text(value)): MergeField => ({
  key,
  label,
  read: (patient) => read(getIn(patient, path)),
  copy: (result, from) => setIn(result, path, getIn(from, path)),
});

/** The first ContactPoint of a system, copied whole with its `use` and `rank`. */
const contact = (key: string, label: string, system: string): MergeField => ({
  key,
  label,
  read: (patient) => text(patient.telecom?.find((t) => t.system === system)?.value),
  copy: (result, from) => {
    const value = from.telecom?.find((t) => t.system === system);
    const telecom = [...(result.telecom ?? [])];
    const index = telecom.findIndex((t) => t.system === system);
    if (index >= 0) telecom.splice(index, 1, ...(value ? [structuredClone(value)] : []));
    else if (value) telecom.push(structuredClone(value));
    result.telecom = telecom;
  },
});

/** Attributes shown side by side on the review page; rows empty in both records are hidden. */
export const MERGE_FIELDS: MergeField[] = [
  at("given", "First name", ["name", 0, "given", 0]),
  at("middle", "Middle name", ["name", 0, "given", 1]),
  at("family", "Last name", ["name", 0, "family"]),
  at("gender", "Gender", ["gender"]),
  at("birthDate", "Birth date", ["birthDate"]),
  at("maritalStatus", "Marital status", ["maritalStatus"], (value) => text(conceptText(value as CodeableConcept))),
  contact("phone", "Phone", "phone"),
  contact("email", "Email", "email"),
  at("line1", "Street", ["address", 0, "line", 0]),
  at("line2", "Street 2", ["address", 0, "line", 1]),
  at("city", "City", ["address", 0, "city"]),
  at("state", "State", ["address", 0, "state"]),
  at("postalCode", "ZIP", ["address", 0, "postalCode"]),
  at("country", "Country", ["address", 0, "country"]),
  at("language", "Language", ["communication", 0, "language"], (value) => text(conceptText(value as CodeableConcept))),
];

export type Selection = {
  /** The record that keeps its id and receives the references; the other one is deleted. */
  survivor: Side;
  /** Which record each attribute comes from. */
  choices: Record<string, Side>;
};

const filledCount = (patient: Patient) => MERGE_FIELDS.filter((field) => field.read(patient) !== "").length;

/** The more complete record survives, and its empty attributes are filled from the other record. */
export function defaultSelection(records: [Patient, Patient]): Selection {
  const survivor: Side = filledCount(records[1]) > filledCount(records[0]) ? 1 : 0;
  const other: Side = survivor === 0 ? 1 : 0;
  const choices = Object.fromEntries(
    MERGE_FIELDS.map((field) => [field.key, field.read(records[survivor]) === "" && field.read(records[other]) !== "" ? other : survivor]),
  );
  return { survivor, choices };
}

/** Everything taken from one record. */
export function selectAll(side: Side): Selection {
  return { survivor: side, choices: Object.fromEntries(MERGE_FIELDS.map((field) => [field.key, side])) };
}

/**
 * The complete desired state of the surviving record, sent to `$merge/v2` as `result`: the survivor with
 * the chosen attributes copied from the other record, and the identifiers of both records.
 */
export function mergeResult(records: [Patient, Patient], { survivor, choices }: Selection): Patient {
  const result = structuredClone(records[survivor]);
  for (const field of MERGE_FIELDS) {
    const side = choices[field.key] ?? survivor;
    if (side !== survivor) field.copy(result, records[side]);
  }
  result.identifier = mergedIdentifiers(records[survivor], records[survivor === 0 ? 1 : 0]);
  // Server-managed metadata, and a narrative that no longer matches the data.
  delete result.meta;
  delete result.text;
  return prune(result) as Patient;
}

const identifierKey = (identifier: Identifier) => `${identifier.system ?? ""}|${identifier.value ?? ""}`;

/** The survivor's identifiers plus the ones only the other record has. */
export function mergedIdentifiers(survivor: Patient, other: Patient): Identifier[] {
  const known = new Set((survivor.identifier ?? []).map(identifierKey));
  return [...(survivor.identifier ?? []), ...(other.identifier ?? []).filter((identifier) => !known.has(identifierKey(identifier)))];
}

export type IdentifierRow = { identifier: Identifier; inRecords: [boolean, boolean] };

/** Identifiers of both records, each with the records that have it. */
export function identifierRows(records: [Patient, Patient]): IdentifierRow[] {
  const keys = records.map((record) => new Set((record.identifier ?? []).map(identifierKey)));
  return mergedIdentifiers(records[0], records[1]).map((identifier) => ({
    identifier,
    inRecords: [keys[0].has(identifierKey(identifier)), keys[1].has(identifierKey(identifier))],
  }));
}

export const identifierLabel = (identifier: Identifier) =>
  conceptText(identifier.type) ?? identifier.system?.replace(/^https?:\/\//, "") ?? "Identifier";

/** Drops what copying absent attributes leaves behind: empty values, empty arrays and objects, array holes. */
function prune(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, prune(item)] as const)
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value === "" || value === null ? undefined : value;
}
