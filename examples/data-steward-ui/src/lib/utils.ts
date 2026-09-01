import type { GetPatientsFilter, SearchParamsObj } from "@/api/types";

export const searchParamsToGetPatientsFilter = (
  searchParams: SearchParamsObj
): GetPatientsFilter => ({
  id: (searchParams["id"] as string) || undefined,
  firstName: (searchParams["firstname"] as string) || undefined,
  lastName: (searchParams["lastname"] as string) || undefined,
  birthdate: (searchParams["birthdate"] as string) || undefined,
  phone: (searchParams["phonenumber"] as string) || undefined,
  email: (searchParams["email"] as string) || undefined,
});

export function paramsToObject(searchParams: URLSearchParams): SearchParamsObj {
  const obj: SearchParamsObj = {};
  const keys = new Set([...searchParams.keys()]);
  for (const key of keys) {
    const values = searchParams.getAll(key);
    obj[key] = values.length === 1 ? values[0] : values;
  }
  return obj;
}

const dateFormatterUS = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

export const toUSformat = (dateString: string): string => {
  return dateFormatterUS.format(new Date(dateString));
};

// Format a FHIR date (YYYY-MM-DD) as US-style M/D/YYYY without timezone shifts.
// Parsing the string directly avoids `new Date("2008-05-07")` being interpreted
// as UTC midnight and shifting a day in western time zones.
export const toUSDate = (s: string | undefined | null): string => {
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const [, y, mo, d] = m;
  return `${parseInt(mo, 10)}/${parseInt(d, 10)}/${y}`;
};

// Em-dash placeholder for empty/missing values in the UI.
export const DASH = "—";
export const withDash = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return DASH;
  const s = String(v);
  return s.length === 0 ? DASH : s;
};
