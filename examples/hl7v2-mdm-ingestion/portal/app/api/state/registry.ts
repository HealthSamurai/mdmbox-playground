export type PatientKindFilter = "all" | "golden" | "singleton";
export type ConditionDuplicatesFilter = "all" | "present";

export type RegistryQuery = {
  patientKind: PatientKindFilter;
  conditionDuplicates: ConditionDuplicatesFilter;
  patientId: string | null;
  page: number;
  pageSize: number;
};

type RegistryPatientCard = {
  id: string;
  kind: "golden" | "singleton";
  duplicateConditionCount: number;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function positiveInteger(value: string | null, fallback: number): number {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseRegistryQuery(url: string): RegistryQuery {
  const searchParams = new URL(url).searchParams;
  const requestedPatientKind = searchParams.get("patientKind");
  const requestedDuplicates = searchParams.get("conditionDuplicates");

  return {
    patientKind:
      requestedPatientKind === "golden" ||
      requestedPatientKind === "singleton"
        ? requestedPatientKind
        : "all",
    conditionDuplicates:
      requestedDuplicates === "present" ? "present" : "all",
    patientId: searchParams.get("patientId"),
    page: positiveInteger(searchParams.get("page"), 1),
    pageSize: Math.min(
      positiveInteger(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    ),
  };
}

export function paginateRegistry<T extends RegistryPatientCard>(
  patientCards: T[],
  query: RegistryQuery,
) {
  const filtered = patientCards.filter(
    (card) =>
      (query.patientKind === "all" || card.kind === query.patientKind) &&
      (query.conditionDuplicates === "all" ||
        card.duplicateConditionCount > 0) &&
      (query.patientId === null || card.id === query.patientId),
  );
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.pageSize;

  return {
    patientCards: filtered.slice(offset, offset + query.pageSize),
    registry: {
      page,
      pageSize: query.pageSize,
      total,
      totalPages,
      patientKind: query.patientKind,
      conditionDuplicates: query.conditionDuplicates,
    },
  };
}
