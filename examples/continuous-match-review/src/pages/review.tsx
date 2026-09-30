import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, Ban, Check, GitMerge } from "lucide-react";
import { findMergeOf, getModel, getPatientRecord, type PatientRecord } from "../api/aidbox";
import { markNotAMatch, mergePatients, type MatchPair, type MergeResponse } from "../api/mdmbox";
import type { Patient, Task } from "../api/fhir";
import { errorMessage } from "../api/http";
import { useAsync } from "../lib/use-async";
import { displayName, timeAgo } from "../lib/format";
import {
  defaultSelection,
  identifierLabel,
  identifierRows,
  MERGE_FIELDS,
  mergeResult,
  selectAll,
  type Selection,
  type Side,
} from "../lib/merge-fields";
import { Badge, Button, Card, cx, ErrorNotice, Modal, Spinner } from "../components/ui";
import { DECISIONS, DecisionBadge, FeatureBreakdown, Score } from "../components/match";

/** Router state passed from the queue: the pair as listed and the queue URL to return to. */
type ReviewState = { pair?: MatchPair; back?: string };

type Loaded = {
  records: [PatientRecord, PatientRecord];
  /** Merge Task of each record that was merged away. */
  merges: [Task | undefined, Task | undefined];
};

async function loadRecords(ids: [string, string]): Promise<Loaded> {
  const found = await Promise.all(ids.map(getPatientRecord));
  const missing = found.findIndex((record) => record === null);
  if (missing >= 0) throw new Error(`Patient/${ids[missing]} does not exist.`);
  const records = found as Loaded["records"];
  const merges = await Promise.all(records.map((record) => (record.deleted ? findMergeOf(record.patient.id) : undefined)));
  return { records, merges: merges as Loaded["merges"] };
}

const SIDE_LABELS = ["Record A", "Record B"] as const;

const pairUrl = (idA: string, idB: string, modelId: string | null) =>
  `/pairs/${encodeURIComponent(idA)}/${encodeURIComponent(idB)}${modelId ? `?model=${encodeURIComponent(modelId)}` : ""}`;

export function ReviewPage() {
  const { id1 = "", id2 = "" } = useParams();
  const [params] = useSearchParams();
  const modelId = params.get("model");
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state ?? {}) as ReviewState;
  const pair = state.pair?.resourceId1 === id1 && state.pair?.resourceId2 === id2 ? state.pair : undefined;
  const back = state.back ?? (modelId ? `/?model=${encodeURIComponent(modelId)}` : "/");

  const loaded = useAsync(() => loadRecords([id1, id2]), [id1, id2]);
  const model = useAsync(() => (modelId ? getModel(modelId) : Promise.resolve(undefined)), [modelId]);

  return (
    <div className="space-y-5">
      <Link to={back} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
        <ArrowLeft className="size-4" aria-hidden />
        Back to queue
      </Link>

      <Card className="flex flex-wrap items-start justify-between gap-6 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Review pair</h1>
            {pair && <DecisionBadge status={pair.decisionStatus} />}
          </div>
          <p className="mt-1 font-mono text-xs text-gray-500">
            Patient/{id1} ↔ Patient/{id2}
          </p>
          {pair && (
            <div className="mt-3">
              <div className="text-xs text-gray-500">Match weight{modelId && ` · ${modelId}`}</div>
              <Score weight={pair.matchWeight} model={model.data} large />
            </div>
          )}
        </div>
        {pair && (
          <div className="w-full max-w-md">
            <div className="mb-2 text-xs font-medium text-gray-500 uppercase">Evidence by feature</div>
            <FeatureBreakdown details={pair.matchDetails} model={model.data} />
          </div>
        )}
      </Card>

      {loaded.error && <ErrorNotice error={loaded.error} />}
      {!loaded.data && !loaded.error && <Spinner />}
      {loaded.data && (
        <PairReview
          // Start over with the default selection when the records change.
          key={loaded.data.records.map((r) => `${r.patient.id}@${r.patient.meta?.versionId}`).join("|")}
          loaded={loaded.data}
          pair={pair}
          modelId={modelId}
          onDone={() => navigate(back)}
        />
      )}
    </div>
  );
}

type PairReviewProps = {
  loaded: Loaded;
  pair?: MatchPair;
  modelId: string | null;
  onDone: () => void;
};

function PairReview({ loaded, pair, modelId, onDone }: PairReviewProps) {
  const { records, merges } = loaded;
  const patients: [Patient, Patient] = [records[0].patient, records[1].patient];
  const [selection, setSelection] = useState<Selection>(() => defaultSelection(patients));
  const [mergeRequest, setMergeRequest] = useState<MergeRequest>();
  const [notAMatchOpen, setNotAMatchOpen] = useState(false);

  const decided = pair !== undefined && pair.decisionStatus !== "pending";
  const deleted = records.some((record) => record.deleted);
  const readOnly = decided || deleted;

  const openMerge = () => {
    const survivor = selection.survivor;
    const other: Side = survivor === 0 ? 1 : 0;
    setMergeRequest({
      targetId: patients[survivor].id,
      sourceId: patients[other].id,
      result: mergeResult(patients, selection),
    });
  };

  return (
    <>
      {records.map((record, side) =>
        record.deleted ? (
          <MergedAwayNotice
            key={record.patient.id}
            patient={record.patient}
            task={merges[side]}
            other={records[side === 0 ? 1 : 0]}
            modelId={modelId}
          />
        ) : null,
      )}
      {decided && !deleted && (
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
          This pair is already decided: <DecisionBadge status={pair.decisionStatus} />
        </div>
      )}

      <Card>
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="font-semibold">{readOnly ? "Compare records" : "Select attributes to keep"}</h2>
          {!readOnly && (
            <p className="mt-1 text-sm text-gray-500">
              The surviving record keeps its id and receives the references of the other record, which is deleted. Pick the value to keep
              for each attribute that differs.
            </p>
          )}
        </div>
        <MergeGrid
          patients={patients}
          deleted={[records[0].deleted, records[1].deleted]}
          selection={selection}
          onChange={setSelection}
          readOnly={readOnly}
        />
      </Card>

      <IdentifiersCard patients={patients} readOnly={readOnly} />

      {!readOnly && (
        <div className="sticky bottom-0 -mx-6 border-t border-gray-200 bg-white/95 px-6 py-3 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="danger" onClick={() => setNotAMatchOpen(true)}>
              <Ban className="size-4" aria-hidden />
              Not a match
            </Button>
            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-gray-500 sm:inline">
                Keep <span className="font-mono">{patients[selection.survivor].id}</span>, delete{" "}
                <span className="font-mono">{patients[selection.survivor === 0 ? 1 : 0].id}</span>
              </span>
              <Button onClick={onDone}>Cancel</Button>
              <Button variant="primary" onClick={openMerge}>
                <GitMerge className="size-4" aria-hidden />
                Merge…
              </Button>
            </div>
          </div>
        </div>
      )}

      <MergeDialog request={mergeRequest} onClose={() => setMergeRequest(undefined)} onMerged={onDone} />
      <NotAMatchDialog
        open={notAMatchOpen}
        ids={[patients[0].id, patients[1].id]}
        onClose={() => setNotAMatchOpen(false)}
        onMarked={onDone}
      />
    </>
  );
}

type MergeGridProps = {
  patients: [Patient, Patient];
  deleted: [boolean, boolean];
  selection: Selection;
  onChange: (selection: Selection) => void;
  readOnly: boolean;
};

/** Attributes of both records side by side, with a radio button per differing value and the merge result. */
function MergeGrid({ patients, deleted, selection, onChange, readOnly }: MergeGridProps) {
  const result = readOnly ? undefined : mergeResult(patients, selection);
  const fields = MERGE_FIELDS.filter((field) => patients.some((patient) => field.read(patient) !== ""));
  const allFrom = (side: Side) => selection.survivor === side && fields.every((field) => selection.choices[field.key] === side);
  const choose = (key: string, side: Side) => onChange({ ...selection, choices: { ...selection.choices, [key]: side } });
  const sides: Side[] = [0, 1];

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-52" />
          <col />
          <col />
          {result && <col />}
        </colgroup>
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left">
            <th className="px-4 py-2.5 text-xs font-medium text-gray-500 uppercase">Attribute</th>
            {sides.map((side) => (
              <th key={side} className="border-l border-gray-200 px-4 py-2.5 font-normal">
                <label className={cx("flex items-start gap-2.5", !readOnly && "cursor-pointer")}>
                  {!readOnly && (
                    <input
                      type="radio"
                      name="take-all"
                      checked={allFrom(side)}
                      onChange={() => onChange(selectAll(side))}
                      className="mt-0.5 size-4 accent-brand-500"
                      aria-label={`Take everything from ${SIDE_LABELS[side]}`}
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-500 uppercase">
                      {SIDE_LABELS[side]}
                      {deleted[side] && (
                        <Badge tone="violet" className="ml-2 normal-case">
                          deleted
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate font-semibold text-gray-900">{displayName(patients[side])}</span>
                  </span>
                </label>
              </th>
            ))}
            {result && (
              <th className="border-l-2 border-brand-500 bg-brand-50 px-4 py-2.5 text-xs font-medium text-brand-700 uppercase">
                Merge result
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          <GridRow
            label={readOnly ? "Record ID" : "Surviving record"}
            hint={readOnly ? undefined : "keeps its id and references"}
            name="survivor"
            values={[patients[0].id, patients[1].id]}
            chosen={selection.survivor}
            onChoose={(side) => onChange({ ...selection, survivor: side })}
            result={result?.id}
            readOnly={readOnly}
            mono
          />
          {fields.map((field) => (
            <GridRow
              key={field.key}
              label={field.label}
              name={field.key}
              values={[field.read(patients[0]), field.read(patients[1])]}
              chosen={selection.choices[field.key] ?? selection.survivor}
              onChoose={(side) => choose(field.key, side)}
              result={result && field.read(result)}
              readOnly={readOnly}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type GridRowProps = {
  label: string;
  hint?: string;
  name: string;
  values: [string, string];
  chosen: Side;
  onChoose: (side: Side) => void;
  /** Value in the merge result; undefined when there is no result column. */
  result?: string;
  readOnly: boolean;
  mono?: boolean;
};

function GridRow({ label, hint, name, values, chosen, onChoose, result, readOnly, mono }: GridRowProps) {
  const same = values[0] === values[1];
  const sides: Side[] = [0, 1];
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <th scope="row" className="px-4 py-2 text-left align-top font-normal text-gray-600">
        {label}
        {hint && <span className="block text-xs text-gray-400">{hint}</span>}
      </th>
      {sides.map((side) => {
        const value = values[side] || "—";
        const picked = !same && !readOnly && chosen === side;
        return (
          <td key={side} className={cx("border-l border-gray-200 px-4 py-2 align-top", picked && "bg-brand-50/70")}>
            {same || readOnly ? (
              <span
                className={cx(
                  "block break-words",
                  mono ? "font-mono text-xs" : !same && "text-amber-700",
                  !values[side] && "text-gray-400",
                )}
              >
                {value}
              </span>
            ) : (
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name={name}
                  checked={chosen === side}
                  onChange={() => onChoose(side)}
                  className="mt-0.5 size-4 shrink-0 accent-brand-500"
                />
                <span className={cx("min-w-0 break-words", mono && "font-mono text-xs", !values[side] && "text-gray-400")}>{value}</span>
              </label>
            )}
          </td>
        );
      })}
      {result !== undefined && (
        <td
          className={cx(
            "border-l-2 border-brand-500 bg-brand-50/40 px-4 py-2 align-top break-words",
            !same && "font-semibold",
            mono && "font-mono text-xs",
          )}
        >
          {result || <span className="font-normal text-gray-400">—</span>}
        </td>
      )}
    </tr>
  );
}

function IdentifiersCard({ patients, readOnly }: { patients: [Patient, Patient]; readOnly: boolean }) {
  const rows = identifierRows(patients);
  if (rows.length === 0) return null;
  return (
    <Card>
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 className="font-semibold">Identifiers</h2>
        {!readOnly && <p className="mt-1 text-sm text-gray-500">The surviving record keeps the identifiers of both records.</p>}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Value</th>
            <th className="w-28 px-4 py-2 text-center font-medium">{SIDE_LABELS[0]}</th>
            <th className="w-28 px-4 py-2 text-center font-medium">{SIDE_LABELS[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ identifier, inRecords }) => (
            <tr key={`${identifier.system}|${identifier.value}`} className="border-b border-gray-100 last:border-0">
              <td className="px-4 py-2 text-gray-600">{identifierLabel(identifier)}</td>
              <td className="px-4 py-2 font-mono text-xs break-all">{identifier.value}</td>
              {inRecords.map((present, side) => (
                <td key={side} className="px-4 py-2 text-center">
                  {present ? (
                    <Check className="inline size-4 text-emerald-600" aria-label="present" />
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function MergedAwayNotice({
  patient,
  task,
  other,
  modelId,
}: {
  patient: Patient;
  task?: Task;
  other: PatientRecord;
  modelId: string | null;
}) {
  const survivorId = task?.focus?.reference?.split("/")[1];
  const reviewSurvivor = survivorId && survivorId !== other.patient.id && !other.deleted;
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
      <span className="font-mono">Patient/{patient.id}</span> ({displayName(patient)}) no longer exists
      {survivorId ? (
        <>
          : it was merged into <span className="font-mono">Patient/{survivorId}</span>
          {task?.authoredOn && ` ${timeAgo(task.authoredOn)}`}.
        </>
      ) : (
        "."
      )}{" "}
      Its last version is shown below.
      {reviewSurvivor && (
        <Link to={pairUrl(survivorId, other.patient.id, modelId)} className="ml-1 font-medium text-violet-700 underline underline-offset-2">
          Review Patient/{survivorId} and Patient/{other.patient.id} instead
        </Link>
      )}
    </div>
  );
}

type MergeRequest = { sourceId: string; targetId: string; result: Patient };

/** Records MDMbox adds to every merge: the Task to unmerge with, its Provenance and the AuditEvent. */
const isAuditRecord = (url = "") => ["Task", "Provenance", "AuditEvent"].includes(url.split(/[/?]/)[0]);

/** Shows the plan from a `$merge/v2` preview, then executes the same request. */
function MergeDialog({ request, onClose, onMerged }: { request?: MergeRequest; onClose: () => void; onMerged: () => void }) {
  const [preview, setPreview] = useState<MergeResponse | Error>();
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!request) return;
    let current = true;
    setPreview(undefined);
    mergePatients({ ...request, preview: true }).then(
      (response) => current && setPreview(response),
      (error: Error) => current && setPreview(error),
    );
    return () => {
      current = false;
    };
  }, [request]);

  const merge = async () => {
    if (!request) return;
    setMerging(true);
    try {
      const { task } = await mergePatients({ ...request, preview: false });
      toast.success("Records merged", {
        description: `Patient/${request.sourceId} was merged into Patient/${request.targetId}${task?.id ? ` (Task/${task.id})` : ""}.`,
      });
      onClose();
      onMerged();
    } catch (e) {
      toast.error("Merge failed", { description: errorMessage(e) });
    } finally {
      setMerging(false);
    }
  };

  const plan = preview && !(preview instanceof Error) ? preview.plan : undefined;
  const warnings =
    preview && !(preview instanceof Error) ? (preview.outcome?.issue ?? []).filter((issue) => issue.severity === "warning") : [];
  const entries = plan?.entry ?? [];
  const changes = entries.filter((entry) => !isAuditRecord(entry.request?.url));
  const audit = entries.filter((entry) => isAuditRecord(entry.request?.url));

  return (
    <Modal
      open={!!request}
      onClose={onClose}
      title="Merge records"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={merge} loading={merging} disabled={!plan}>
            Merge
          </Button>
        </>
      }
    >
      {request && (
        <p>
          <span className="font-mono">Patient/{request.sourceId}</span> will be deleted and its references moved to{" "}
          <span className="font-mono">Patient/{request.targetId}</span>, which gets the selected attributes. MDMbox records the merge, so it
          can be undone with <span className="font-mono">$unmerge/v2</span>.
        </p>
      )}
      <div className="mt-4">
        <div className="mb-2 text-xs font-medium text-gray-500 uppercase">Planned changes</div>
        {!preview && <Spinner label="Building the merge plan…" />}
        {preview instanceof Error && <ErrorNotice error={preview} />}
        {plan && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {changes.map((entry, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2">
                <Badge tone={entry.request?.method === "DELETE" ? "red" : entry.request?.method === "POST" ? "green" : "blue"}>
                  {entry.request?.method}
                </Badge>
                <span className="font-mono text-xs break-all">{entry.request?.url}</span>
              </li>
            ))}
          </ul>
        )}
        {audit.length > 0 && (
          <p className="mt-2 text-xs text-gray-500">
            In the same transaction MDMbox creates the audit trail: {audit.map((entry) => entry.request?.url).join(", ")}.
          </p>
        )}
        {warnings.map((issue, i) => (
          <p key={i} className="mt-3 text-amber-800">
            {issue.details?.text ?? issue.diagnostics}
          </p>
        ))}
      </div>
    </Modal>
  );
}

function NotAMatchDialog({
  open,
  ids,
  onClose,
  onMarked,
}: {
  open: boolean;
  ids: [string, string];
  onClose: () => void;
  onMarked: () => void;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await markNotAMatch(ids[0], ids[1], note.trim() || undefined);
      toast.success("Marked as not a match", { description: "MDMbox will refuse to link or merge this pair." });
      onClose();
      onMarked();
    } catch (e) {
      toast.error("Could not save the decision", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={DECISIONS["not-a-match"].label}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving}>
            Mark as not a match
          </Button>
        </>
      }
    >
      <p>
        <span className="font-mono">Patient/{ids[0]}</span> and <span className="font-mono">Patient/{ids[1]}</span> will be recorded as
        different people. Both records stay unchanged. MDMbox has no operation to revoke this decision.
      </p>
      <label className="mt-4 block">
        <span className="text-xs font-medium text-gray-500 uppercase">Note (optional)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          placeholder="e.g. Twins: same address and birth date"
        />
      </label>
    </Modal>
  );
}
