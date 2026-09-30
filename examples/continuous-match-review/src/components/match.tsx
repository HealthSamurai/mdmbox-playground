import type { BulkMatchingModel } from "../api/aidbox";
import type { DecisionStatus } from "../api/mdmbox";
import { evidence, featureLabel, featureMaxima, gradeOf, type Grade } from "../lib/model";
import { formatSigned, formatWeight } from "../lib/format";
import { Badge, cx, type Tone } from "./ui";

export const DECISIONS: Record<DecisionStatus, { label: string; tone: Tone }> = {
  pending: { label: "To review", tone: "amber" },
  merged: { label: "Merged", tone: "violet" },
  "not-a-match": { label: "Not a match", tone: "gray" },
};

const GRADES: Record<Grade, { label: string; tone: Tone }> = {
  certain: { label: "Certain", tone: "green" },
  probable: { label: "Probable", tone: "blue" },
  possible: { label: "Possible", tone: "gray" },
};

export function DecisionBadge({ status }: { status: DecisionStatus }) {
  // A pair linked outside this app comes as `linked`: show it as is.
  const decision = DECISIONS[status] ?? { label: status, tone: "gray" };
  return <Badge tone={decision.tone}>{decision.label}</Badge>;
}

/** Match weight with its grade by the model thresholds. */
export function Score({ weight, model, large }: { weight: number; model?: BulkMatchingModel; large?: boolean }) {
  const grade = gradeOf(weight, model);
  return (
    <div className="flex items-center gap-2">
      <span className={cx("font-semibold tabular-nums", large ? "text-2xl" : "text-base")}>{formatWeight(weight)}</span>
      {grade && <Badge tone={GRADES[grade].tone}>{GRADES[grade].label}</Badge>}
    </div>
  );
}

/** Features that raised (green) or lowered (red) the weight of a pair. */
export function EvidenceChips({ details, limit }: { details: Record<string, number>; limit?: number }) {
  const items = evidence(details);
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map(([name, weight]) => (
        <span
          key={name}
          className={cx(
            "rounded px-1.5 py-0.5 text-xs whitespace-nowrap tabular-nums",
            weight > 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700",
          )}
        >
          {featureLabel(name)} {formatSigned(weight)}
        </span>
      ))}
      {shown.length < items.length && <span className="px-1 py-0.5 text-xs text-gray-500">+{items.length - shown.length}</span>}
    </div>
  );
}

/** Every model feature with its contribution to the pair and the most it could contribute. */
export function FeatureBreakdown({ details, model }: { details: Record<string, number>; model?: BulkMatchingModel }) {
  const maxima = featureMaxima(model);
  const names = [...new Set([...Object.keys(maxima), ...Object.keys(details)])];
  const scale = Math.max(1, ...names.map((name) => Math.max(maxima[name] ?? 0, Math.abs(details[name] ?? 0))));
  return (
    <ul className="space-y-1.5">
      {names.map((name) => {
        const weight = details[name] ?? 0;
        return (
          <li key={name} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-3 text-sm">
            <span className="truncate text-gray-600">{featureLabel(name)}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <span
                className={cx("block h-full rounded-full", weight > 0 ? "bg-emerald-500" : "bg-red-400")}
                style={{ width: `${(Math.abs(weight) / scale) * 100}%` }}
              />
            </span>
            <span
              className={cx("text-right tabular-nums", weight > 0 ? "text-emerald-700" : weight < 0 ? "text-red-700" : "text-gray-400")}
            >
              {weight === 0 ? "0" : formatSigned(weight)}
              {maxima[name] !== undefined && <span className="text-gray-400"> / {formatWeight(maxima[name])}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
