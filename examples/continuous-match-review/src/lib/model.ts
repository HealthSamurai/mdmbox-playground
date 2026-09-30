import type { BulkMatchingModel } from "../api/aidbox";

/** `certain` and `probable` come from the model thresholds; continuous matching keeps pairs from `probable` up. */
export type Grade = "certain" | "probable" | "possible";

export function gradeOf(weight: number, model?: BulkMatchingModel): Grade | undefined {
  const { certain, probable } = model?.thresholds ?? {};
  if (certain === undefined && probable === undefined) return undefined;
  if (certain !== undefined && weight >= certain) return "certain";
  if (probable !== undefined && weight >= probable) return "probable";
  return "possible";
}

/** The highest weight each feature can contribute, e.g. `{ family: 10, birth_date: 12 }`. */
export function featureMaxima(model?: BulkMatchingModel): Record<string, number> {
  return Object.fromEntries(
    (model?.feature ?? []).map((feature) => [feature.name, Math.max(0, ...feature.case.map((c) => c.weight ?? c.else ?? 0))]),
  );
}

/** Weight of a pair that agrees on every feature. */
export function maxWeight(model?: BulkMatchingModel): number | undefined {
  const maxima = Object.values(featureMaxima(model));
  return maxima.length ? maxima.reduce((sum, weight) => sum + weight, 0) : undefined;
}

/** `birth_date` → `Birth date` */
export function featureLabel(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Feature weights of a pair, strongest evidence first; features that contributed nothing are left out. */
export function evidence(matchDetails: Record<string, number>): [string, number][] {
  return Object.entries(matchDetails)
    .filter(([, weight]) => weight !== 0)
    .sort(([, a], [, b]) => b - a);
}
