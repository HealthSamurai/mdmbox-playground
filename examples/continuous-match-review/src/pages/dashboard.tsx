import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Inbox, Play, RefreshCw } from "lucide-react";
import { getModel, getPatients, listPatientModels, type BulkMatchingModel } from "../api/aidbox";
import {
  countPairs,
  DECISION_STATUSES,
  getPairs,
  getProcessStatus,
  startProcess,
  type DecisionStatus,
  type MatchPair,
  type ProcessState,
  type ProcessStatus,
} from "../api/mdmbox";
import type { Patient } from "../api/fhir";
import { errorMessage } from "../api/http";
import { useAsync, useInterval } from "../lib/use-async";
import { displayName, formatCount, formatShare, timeAgo } from "../lib/format";
import { maxWeight } from "../lib/model";
import { Badge, Button, Card, cx, ErrorNotice, Spinner, type Tone } from "../components/ui";
import { DECISIONS, DecisionBadge, EvidenceChips, Score } from "../components/match";

type Filter = DecisionStatus | "all";

const PAGE_SIZES = [10, 20, 50, 100];
const DEFAULTS = { status: "pending", page: "1", size: "20" };
const STATUS_POLL_MS = 5000;

const positiveInt = (value: string | null, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const readFilter = (value: string | null): Filter =>
  value === "all" || DECISION_STATUSES.includes(value as DecisionStatus) ? (value as Filter) : "pending";

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const modelId = params.get("model");
  const models = useAsync(listPatientModels, []);

  // Query parameters hold the view, so going back from a pair returns to the same page.
  const update = useCallback(
    (changes: Record<string, string | number>) =>
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (String(value) === DEFAULTS[key as keyof typeof DEFAULTS]) next.delete(key);
          else next.set(key, String(value));
        }
        return next;
      }),
    [setParams],
  );

  // Without a model in the URL, open the first one that has a continuous matching process.
  useEffect(() => {
    if (modelId || !models.data?.length) return;
    let current = true;
    Promise.all(models.data.map((model) => getProcessStatus(model.id).catch(() => null))).then((statuses) => {
      const index = Math.max(0, statuses.findIndex(Boolean));
      if (current) setParams({ model: models.data![index].id }, { replace: true });
    });
    return () => {
      current = false;
    };
  }, [modelId, models.data, setParams]);

  if (models.error) return <ErrorNotice error={models.error} />;
  if (!models.data) return <Spinner />;
  if (models.data.length === 0) {
    return (
      <EmptyState title="No matching model for Patient">
        Install the example BulkMatchingModel with <code className="rounded bg-gray-100 px-1">bun run setup</code>, or create one in MDMbox
        Admin.
      </EmptyState>
    );
  }
  if (!modelId) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Continuous matching review</h1>
          <p className="mt-1 text-sm text-gray-500">
            Pairs of patient records found by MDMbox. Open a pair to merge it or mark it as not a match.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Model
          <select
            value={modelId}
            onChange={(e) => setParams({ model: e.target.value })}
            className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-900 shadow-xs"
          >
            {!models.data.some((model) => model.id === modelId) && <option value={modelId}>{modelId}</option>}
            {models.data.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ModelDashboard
        key={modelId}
        modelId={modelId}
        filter={readFilter(params.get("status"))}
        page={positiveInt(params.get("page"), 1)}
        size={positiveInt(params.get("size"), Number(DEFAULTS.size))}
        update={update}
      />
    </div>
  );
}

type ViewProps = {
  modelId: string;
  filter: Filter;
  page: number;
  size: number;
  update: (changes: Record<string, string | number>) => void;
};

function ModelDashboard(props: ViewProps) {
  const status = useAsync(() => getProcessStatus(props.modelId), [props.modelId]);
  // Continuous matching keeps finding pairs: poll the counters.
  useInterval(status.reload, STATUS_POLL_MS);

  if (status.data === undefined) {
    return status.error ? (
      <ErrorNotice
        error={status.error}
        action={
          <Button size="sm" onClick={status.reload}>
            Retry
          </Button>
        }
      />
    ) : (
      <Spinner />
    );
  }
  if (status.data === null) return <NoProcess modelId={props.modelId} onStarted={status.reload} />;
  return <ProcessDashboard {...props} status={status.data} statusError={status.error} />;
}

function NoProcess({ modelId, onStarted }: { modelId: string; onStarted: () => void }) {
  const [starting, setStarting] = useState(false);
  const start = async () => {
    setStarting(true);
    try {
      await startProcess(modelId);
      toast.success("Continuous matching started", { description: "Existing records are matched first, then every new insert." });
      onStarted();
    } catch (e) {
      toast.error("Could not start continuous matching", { description: errorMessage(e) });
    } finally {
      setStarting(false);
    }
  };
  return (
    <EmptyState title={`Continuous matching isn't running for ${modelId}`}>
      <p>Start it to match the existing patients and keep matching new ones. Found pairs appear here for review.</p>
      <Button variant="primary" className="mt-5" loading={starting} onClick={start}>
        <Play className="size-4" aria-hidden />
        Start continuous matching
      </Button>
    </EmptyState>
  );
}

type Counts = Record<DecisionStatus, number>;

type TableData = {
  pairs: MatchPair[];
  total: number;
  patients: Map<string, Patient>;
};

async function loadCounts(modelId: string): Promise<Counts> {
  const counts = await Promise.all(DECISION_STATUSES.map(async (status) => [status, await countPairs(modelId, status)] as const));
  return Object.fromEntries(counts) as Counts;
}

async function loadTable(modelId: string, filter: Filter, page: number, size: number): Promise<TableData> {
  // The API numbers pages from zero, the UI from one.
  const { entries, total } = await getPairs(modelId, {
    page: page - 1,
    count: size,
    decisionStatus: filter === "all" ? undefined : filter,
  });
  const ids = [...new Set(entries.flatMap((pair) => [pair.resourceId1, pair.resourceId2]))];
  return { pairs: entries, total, patients: await getPatients(ids) };
}

function ProcessDashboard({
  modelId,
  filter,
  page,
  size,
  update,
  status,
  statusError,
}: ViewProps & { status: ProcessStatus; statusError?: Error }) {
  const model = useAsync(() => getModel(modelId, status.modelVersion), [modelId, status.modelVersion]);
  const [refreshKey, setRefreshKey] = useState(0);
  const counts = useAsync(() => loadCounts(modelId), [modelId, refreshKey]);
  const table = useAsync(() => loadTable(modelId, filter, page, size), [modelId, filter, page, size, refreshKey]);

  // Pair count when the queue was last loaded, to announce pairs found since then.
  const [loadedPairs, setLoadedPairs] = useState(status.pairs);
  const newPairs = status.pairs - loadedPairs;
  const refresh = () => {
    setLoadedPairs(status.pairs);
    setRefreshKey((key) => key + 1);
  };

  // The first pairs arrive when the initial build is done: load them without waiting for Refresh.
  const [building, setBuilding] = useState(status.status === "building");
  if (building !== (status.status === "building")) {
    setBuilding(!building);
    if (building) refresh();
  }

  // A page can run empty after decisions move its pairs out of the filter: go to the last page.
  const pages = table.data && Math.max(1, Math.ceil(table.data.total / size));
  useEffect(() => {
    if (!table.loading && pages !== undefined && page > pages) update({ page: pages });
  }, [table.loading, page, pages, update]);

  return (
    <>
      <ProcessCard modelId={modelId} status={status} model={model.data} error={statusError} />
      <DecisionTiles counts={counts.data} pairs={status.pairs} filter={filter} onSelect={(next) => update({ status: next, page: 1 })} />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="font-semibold">{filter === "all" ? "All pairs" : DECISIONS[filter].label}</h2>
          <div className="flex items-center gap-2">
            {newPairs > 0 && (
              <span className="text-sm text-brand-700">
                {formatCount(newPairs)} new {newPairs === 1 ? "pair" : "pairs"} found
              </span>
            )}
            <Button size="sm" variant={newPairs > 0 ? "primary" : "secondary"} onClick={refresh} loading={table.loading && !!table.data}>
              {!(table.loading && table.data) && <RefreshCw className="size-3.5" aria-hidden />}
              Refresh
            </Button>
          </div>
        </div>
        {table.error && (
          <div className="p-4">
            <ErrorNotice error={table.error} />
          </div>
        )}
        {!table.data && !table.error && <Spinner />}
        {table.data && (
          <PairsTable
            data={table.data}
            model={model.data}
            filter={filter}
            modelId={modelId}
            building={building}
            dimmed={table.loading}
            firstRank={(page - 1) * size + 1}
          />
        )}
        {table.data && (
          <Pagination
            page={page}
            size={size}
            rows={table.data.pairs.length}
            total={table.data.total}
            onPage={(next) => update({ page: next })}
            onSize={(next) => update({ size: next, page: 1 })}
          />
        )}
      </Card>
    </>
  );
}

const PROCESS_STATES: Record<ProcessState, { label: string; tone: Tone }> = {
  idle: { label: "Idle", tone: "gray" },
  building: { label: "Preparing data", tone: "blue" },
  running: { label: "Running", tone: "green" },
  pausing: { label: "Pausing", tone: "amber" },
  paused: { label: "Paused", tone: "gray" },
  failed: { label: "Failed", tone: "red" },
};

function ProcessCard({
  modelId,
  status,
  model,
  error,
}: {
  modelId: string;
  status: ProcessStatus;
  model?: BulkMatchingModel;
  error?: Error;
}) {
  const state = PROCESS_STATES[status.status] ?? { label: status.status, tone: "gray" };
  const { batches } = status;
  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="flex items-center gap-2">
          <Badge tone={state.tone}>
            {status.status === "running" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
            {state.label}
          </Badge>
          {status.stage && <span className="text-sm text-gray-500">{status.stage}</span>}
        </div>
        <Stat label="Model" value={`${modelId}${status.modelVersion ? ` · v${status.modelVersion}` : ""}`} />
        <Stat
          label="Thresholds"
          value={model?.thresholds ? `certain ≥ ${model.thresholds.certain ?? "—"}, probable ≥ ${model.thresholds.probable ?? "—"}` : "—"}
        />
        <Stat label="Records waiting" value={formatCount(status.waitingRecords)} />
        <Stat label="Batches" value={`${formatCount(batches.completed)} / ${formatCount(batches.total)}`} />
        <Stat label="Errors" value={formatCount(status.errors)} alert={status.errors > 0} />
        <Stat label="Status changed" value={timeAgo(status.statusChangedAt) ?? "—"} />
      </div>
      {status.error && <p className="mt-3 text-sm text-red-700">{status.error}</p>}
      {status.modelChanged && (
        <p className="mt-3 text-sm text-amber-800">
          The model was saved after this process started (in use v{status.modelVersion}, latest v{status.currentModelVersion}). Pause and
          rebuild the process in MDMbox Admin to apply it.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-700">Status update failed: {error.message}</p>}
    </Card>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={cx("text-sm font-medium tabular-nums", alert && "text-red-700")}>{value}</div>
    </div>
  );
}

const TILE_BARS: Record<DecisionStatus, string> = {
  pending: "bg-amber-400",
  merged: "bg-violet-500",
  "not-a-match": "bg-gray-400",
};

/** Pair counts by decision; each tile filters the queue. `pairs` is the live count from the process status. */
function DecisionTiles({
  counts,
  pairs,
  filter,
  onSelect,
}: {
  counts?: Counts;
  pairs: number;
  filter: Filter;
  onSelect: (filter: Filter) => void;
}) {
  // Progress uses the decision counts only, so it stays consistent until the next refresh.
  const total = counts ? DECISION_STATUSES.reduce((sum, status) => sum + counts[status], 0) : 0;
  const decided = total - (counts?.pending ?? 0);
  const tiles: { filter: Filter; label: string; count?: number }[] = [
    { filter: "all", label: "Pairs found", count: pairs },
    ...DECISION_STATUSES.map((status) => ({ filter: status, label: DECISIONS[status].label, count: counts?.[status] })),
  ];
  return (
    <Card className="p-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <button
            key={tile.filter}
            type="button"
            onClick={() => onSelect(tile.filter)}
            aria-pressed={filter === tile.filter}
            className={cx(
              "rounded-lg px-4 py-3 text-left transition-colors",
              filter === tile.filter ? "bg-brand-50 ring-2 ring-brand-500" : "hover:bg-gray-50",
            )}
          >
            <div className="flex items-center gap-2 text-sm text-gray-600">
              {tile.filter !== "all" && <span className={cx("size-2 rounded-full", TILE_BARS[tile.filter])} />}
              {tile.label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{tile.count === undefined ? "—" : formatCount(tile.count)}</div>
          </button>
        ))}
      </div>
      {counts && total > 0 && (
        <div className="px-4 pt-3 pb-2">
          <div className="flex h-2 overflow-hidden rounded-full bg-gray-100">
            {(["merged", "not-a-match", "pending"] as const).map((status) => (
              <div key={status} className={TILE_BARS[status]} style={{ width: `${(counts[status] / total) * 100}%` }} />
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {formatCount(decided)} of {formatCount(total)} pairs decided ({formatShare(decided, total)})
          </p>
        </div>
      )}
    </Card>
  );
}

type PairsTableProps = {
  data: TableData;
  model?: BulkMatchingModel;
  filter: Filter;
  modelId: string;
  building: boolean;
  dimmed: boolean;
  /** Position of the first pair of the page in the whole queue. */
  firstRank: number;
};

function PairsTable({ data, model, filter, modelId, building, dimmed, firstRank }: PairsTableProps) {
  const navigate = useNavigate();
  const location = useLocation();

  if (data.pairs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-gray-500">
        <Inbox className="size-8 text-gray-300" aria-hidden />
        {building
          ? "Matching the existing records. Pairs appear here as batches complete."
          : filter === "pending"
            ? "Nothing to review. New pairs appear here as continuous matching finds them."
            : "No pairs here."}
      </div>
    );
  }

  const top = maxWeight(model);
  const open = (pair: MatchPair) =>
    navigate(
      `/pairs/${encodeURIComponent(pair.resourceId1)}/${encodeURIComponent(pair.resourceId2)}?model=${encodeURIComponent(modelId)}`,
      {
        state: { pair, back: location.pathname + location.search },
      },
    );

  return (
    <div className={cx("overflow-x-auto transition-opacity", dimmed && "opacity-60")}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
            <th className="w-12 px-4 py-2 font-medium">#</th>
            <th className="w-44 px-4 py-2 font-medium">Match weight</th>
            <th className="px-4 py-2 font-medium">Record A</th>
            <th className="px-4 py-2 font-medium">Record B</th>
            <th className="px-4 py-2 font-medium">Evidence</th>
            {filter === "all" && <th className="px-4 py-2 font-medium">Decision</th>}
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {data.pairs.map((pair, index) => {
            const a = data.patients.get(pair.resourceId1);
            const b = data.patients.get(pair.resourceId2);
            return (
              <tr
                key={`${pair.resourceId1}|${pair.resourceId2}`}
                onClick={() => open(pair)}
                onKeyDown={(e) => e.key === "Enter" && open(pair)}
                tabIndex={0}
                role="link"
                className="cursor-pointer border-b border-gray-100 align-top last:border-0 hover:bg-brand-50/50 focus-visible:bg-brand-50 focus-visible:outline-none"
              >
                <td className="px-4 py-3 text-gray-400 tabular-nums">{firstRank + index}</td>
                <td className="px-4 py-3">
                  <Score weight={pair.matchWeight} model={model} />
                  {top !== undefined && (
                    <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.min(100, Math.max(0, (pair.matchWeight / top) * 100))}%` }}
                      />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <RecordCell id={pair.resourceId1} patient={a} other={b} />
                </td>
                <td className="px-4 py-3">
                  <RecordCell id={pair.resourceId2} patient={b} other={a} />
                </td>
                <td className="max-w-80 px-4 py-3">
                  <EvidenceChips details={pair.matchDetails} limit={5} />
                </td>
                {filter === "all" && (
                  <td className="px-4 py-3">
                    <DecisionBadge status={pair.decisionStatus} />
                  </td>
                )}
                <td className="py-3 pr-4 text-gray-300">
                  <ChevronRight className="size-4" aria-hidden />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Name, birth date and gender of a record; values that differ from the other record are highlighted. */
function RecordCell({ id, patient, other }: { id: string; patient?: Patient; other?: Patient }) {
  if (!patient) {
    return (
      <div>
        <div className="text-gray-500 italic">Deleted record</div>
        <div className="font-mono text-xs text-gray-400">{id}</div>
      </div>
    );
  }
  const differs = (read: (p: Patient) => string | undefined) =>
    other !== undefined && (read(patient) ?? "").toLowerCase() !== (read(other) ?? "").toLowerCase();
  const highlight = (read: (p: Patient) => string | undefined) => (differs(read) ? "text-amber-700" : undefined);
  const details = [
    { read: (p: Patient) => p.birthDate, value: patient.birthDate },
    { read: (p: Patient) => p.gender, value: patient.gender },
  ].filter((detail) => detail.value);
  return (
    <div className="min-w-0">
      <div className={cx("font-medium", highlight(displayName))}>{displayName(patient)}</div>
      {details.length > 0 && (
        <div className="text-xs text-gray-500">
          {details.map((detail, i) => (
            <span key={i}>
              {i > 0 && " · "}
              <span className={highlight(detail.read)}>{detail.value}</span>
            </span>
          ))}
        </div>
      )}
      <div className="truncate font-mono text-[11px] text-gray-400">{id}</div>
    </div>
  );
}

type PaginationProps = {
  page: number;
  size: number;
  rows: number;
  total: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
};

function Pagination({ page, size, rows, total, onPage, onSize }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / size));
  const first = (page - 1) * size + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
      <label className="flex items-center gap-2">
        Rows per page
        <select
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
          className="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900"
        >
          {PAGE_SIZES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          {rows > 0 && `${formatCount(first)}–${formatCount(first + rows - 1)} of `}
          {formatCount(total)}
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="tabular-nums">
            Page {page} of {pages}
          </span>
          <Button size="sm" variant="ghost" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="px-6 py-14 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mx-auto mt-2 max-w-lg text-sm text-gray-600">{children}</div>
    </Card>
  );
}
