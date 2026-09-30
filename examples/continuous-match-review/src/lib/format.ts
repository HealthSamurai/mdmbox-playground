import type { Patient } from "../api/fhir";

export function displayName(patient?: Patient): string {
  const name = patient?.name?.[0];
  const text = name?.text ?? [...(name?.given ?? []), name?.family].filter(Boolean).join(" ");
  return text || "Unnamed patient";
}

export const formatWeight = (weight: number) => (Number.isInteger(weight) ? String(weight) : weight.toFixed(1));

export const formatSigned = (weight: number) => (weight > 0 ? `+${formatWeight(weight)}` : `−${formatWeight(-weight)}`);

export const formatCount = (count: number) => count.toLocaleString("en-US");

/** `part` of `total` in percent; a small non-zero share shows as `<1%` rather than `0%`. */
export function formatShare(part: number, total: number): string {
  const percent = total > 0 ? (part / total) * 100 : 0;
  return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(iso?: string): string | undefined {
  if (!iso) return undefined;
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
