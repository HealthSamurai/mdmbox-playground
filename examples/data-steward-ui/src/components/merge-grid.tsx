import { useState } from "react";
import { Button, RadioGroup, RadioGroupItem, MdmDrawer, toast } from "@/components/ui";
import { useNavigate, Link } from "react-router";
import { Loader2 } from "lucide-react";
import type { MergePlanEntry, Resource, TransactionBundle } from "mdmbox-sdk";
import { relink } from "mdmbox-sdk";
import { mdmbox } from "@/api/client";
import { mergeIdentifiers } from "@/lib/merge-helpers";
import { toUSDate, withDash } from "@/lib/utils";

type Patient = Record<string, any>;

type FieldConfig = {
  label: string;
  get: (p: Patient) => string;
  set: (p: Patient, v: string) => Patient;
  // Optional display formatter; raw `get`/`set` values still flow through the
  // radio group and merge state, so equality and write-back keep using the
  // underlying FHIR value.
  format?: (v: string) => string;
};

const FIELDS: FieldConfig[] = [
  {
    label: "ID",
    get: (p) => p.id ?? "",
    set: (p, v) => ({ ...p, id: v }),
  },
  {
    label: "First Name",
    get: (p) => p.name?.[0]?.given?.[0] ?? "",
    set: (p, v) => {
      const name = [...(p.name || [{}])];
      name[0] = { ...name[0], given: [v, ...(name[0]?.given?.slice(1) || [])] };
      return { ...p, name };
    },
  },
  {
    label: "Last Name",
    get: (p) => p.name?.[0]?.family ?? "",
    set: (p, v) => {
      const name = [...(p.name || [{}])];
      name[0] = { ...name[0], family: v };
      return { ...p, name };
    },
  },
  {
    label: "Birth Date",
    get: (p) => p.birthDate ?? "",
    set: (p, v) => ({ ...p, birthDate: v }),
    format: toUSDate,
  },
  {
    label: "Email",
    get: (p) => p.telecom?.find((t: any) => t.system === "email")?.value ?? "",
    set: (p, v) => {
      const telecom = [...(p.telecom || [])];
      const idx = telecom.findIndex((t: any) => t.system === "email");
      if (idx >= 0) telecom[idx] = { ...telecom[idx], value: v };
      else telecom.push({ system: "email", value: v });
      return { ...p, telecom };
    },
  },
  {
    label: "City",
    get: (p) => p.address?.[0]?.city ?? "",
    set: (p, v) => {
      const address = [...(p.address || [{}])];
      address[0] = { ...address[0], city: v };
      return { ...p, address };
    },
  },
];

type RowProps = {
  label: string;
  field1: string;
  field2: string;
  selected: string;
  onSelect: (value: string) => void;
  format?: (v: string) => string;
};

function Row({ label, field1, field2, selected, onSelect, format }: RowProps) {
  const isEqual = field1 === field2;
  const display = (v: string) => withDash(format ? format(v) : v);
  return (
    <RadioGroup
      value={selected}
      onValueChange={onSelect}
      className="grid gap-0 grid-cols-[20%_40%_40%] items-stretch border-b last:border-b-0 h-[38px]"
    >
      <div className="text-sm text-muted-foreground font-medium border-r flex items-center py-2 px-3">
        {label}
      </div>
      {isEqual ? (
        <>
          <div className="flex items-center border-r py-2 px-3">
            <span className="text-sm">{display(field1)}</span>
          </div>
          <div className="flex items-center py-2 px-3">
            <span className="text-sm">{display(field2)}</span>
          </div>
        </>
      ) : (
        <>
          <div
            className={`flex items-center border-r py-2 px-3 ${selected === field1 ? "bg-blue-50" : ""}`}
          >
            <RadioGroupItem value={field1} id={`${label}-1`} />
            <label htmlFor={`${label}-1`} className="text-sm cursor-pointer ml-2">
              {display(field1)}
            </label>
          </div>
          <div
            className={`flex items-center py-2 px-3 ${selected === field2 ? "bg-blue-50" : ""}`}
          >
            <RadioGroupItem value={field2} id={`${label}-2`} />
            <label htmlFor={`${label}-2`} className="text-sm cursor-pointer ml-2">
              {display(field2)}
            </label>
          </div>
        </>
      )}
    </RadioGroup>
  );
}

function MergeResultRow({ value, active, format }: { value: string; active: boolean; format?: (v: string) => string }) {
  return (
    <div
      className={`h-[38px] flex items-center py-2 px-3 border-b last:border-b-0 text-sm ${active ? "bg-blue-50 font-bold" : "text-muted-foreground"}`}
    >
      {withDash(format ? format(value) : value)}
    </div>
  );
}

type MergeGridProps = {
  patient1: Patient;
  patient2: Patient;
};

export function MergeGrid({ patient1, patient2 }: MergeGridProps) {
  const navigate = useNavigate();
  const [resultPatient, setResultPatient] = useState<Patient>({ ...patient1 });
  const [headerSelection, setHeaderSelection] = useState<"patient1" | "patient2">("patient1");
  const [isMerging, setIsMerging] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    ok: boolean;
    message: string;
    bundle: TransactionBundle | null;
  } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<MergePlanEntry | null>(null);

  const resetPreview = () => {
    setPreviewResult(null);
    setSelectedEntry(null);
  };

  const handleSelect = (field: FieldConfig, value: string) => {
    resetPreview();
    setResultPatient((prev) => field.set(prev, value));
  };

  const selectAll = (which: "patient1" | "patient2") => {
    resetPreview();
    setHeaderSelection(which);
    const source = which === "patient1" ? patient1 : patient2;
    let updated = { ...resultPatient };
    for (const field of FIELDS) {
      updated = field.set(updated, field.get(source));
    }
    setResultPatient(updated);
  };

  const buildMergePlan = async () => {
    const targetId = resultPatient.id;
    const sourceId = patient2.id === targetId ? patient1.id : patient2.id;
    const sourcePatient = patient2.id === targetId ? patient1 : patient2;
    const targetPatient = patient2.id === targetId ? patient2 : patient1;
    const src = sourcePatient as Resource;
    const tgt = targetPatient as Resource;

    const relatedTypes = [
      "Encounter", "Observation", "Condition",
      "DiagnosticReport", "ServiceRequest", "Specimen",
    ];
    const related: Resource[] = [];
    const maxPages = 50;
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const result = await mdmbox.findRelated({
        resourceType: src.resourceType,
        id: src.id,
        relatedTypes,
        offset,
      });
      if (result.isErr()) {
        toast.error({ title: "Failed to find related resources", description: result.value.resource.issue?.[0]?.diagnostics ?? "Unknown error" });
        return { source: `Patient/${sourceId}`, target: `Patient/${targetId}`, entries: [] };
      }
      const bundle = result.value.resource;
      const resources = (bundle.entry || []).map((e: any) => e.resource as Resource);
      related.push(...resources);
      if (related.length >= (bundle.total ?? 0) || resources.length === 0) break;
      offset += resources.length;
    }
    const relinked = relink(related, sourceId, targetId, "Patient");
    const mergedIdentifiers = mergeIdentifiers(src, tgt);

    const entries: MergePlanEntry[] = [];

    // PUT target with merged data — preserve meta.versionId so SDK can derive ifMatch
    entries.push({
      resource: {
        ...resultPatient,
        identifier: mergedIdentifiers,
        meta: (targetPatient as any).meta,
      },
      request: { method: "PUT", url: `Patient/${targetId}` },
    });

    // PUT each relinked related resource
    for (let i = 0; i < related.length; i++) {
      entries.push({
        resource: relinked[i] as unknown as Record<string, unknown>,
        request: {
          method: "PUT",
          url: `${related[i].resourceType}/${related[i].id}`,
        },
      });
    }

    // DELETE source patient — no resource body, but need ifMatch
    const sourceVersion = (sourcePatient as any).meta?.versionId;
    entries.push({
      request: {
        method: "DELETE",
        url: `Patient/${sourceId}`,
        ...(sourceVersion ? { ifMatch: `W/"${sourceVersion}"` } : {}),
      },
    });

    return {
      source: `Patient/${sourceId}`,
      target: `Patient/${targetId}`,
      entries,
    };
  };

  const merge = async () => {
    setIsMerging(true);
    const plan = await buildMergePlan();
    const result = await mdmbox.merge(plan);

    if (result.isErr()) {
      const outcome = result.value.resource;
      const description =
        outcome.issue?.[0]?.details?.text ??
        outcome.issue?.[0]?.diagnostics ??
        "Unknown error";
      toast.error({ title: "Merge failed", description });
      setIsMerging(false);
      return;
    }

    console.log("Merge completed", result.value);
    navigate(`/patients/${plan.target.split("/")[1]}`);
  };

  const preview = async () => {
    setPreviewResult(null);
    const plan = await buildMergePlan();
    const result = await mdmbox.mergePreview(plan);

    if (result.isErr()) {
      const outcome = result.value.resource;
      const msg =
        outcome.issue?.[0]?.details?.text ??
        outcome.issue?.[0]?.diagnostics ??
        "Preview failed";
      setPreviewResult({ ok: false, message: msg, bundle: null });
      toast.error({ title: "Preview failed", description: msg });
      return;
    }

    const { outcome, bundle } = result.value.resource;
    const msg =
      outcome.issue?.[0]?.details?.text ??
      outcome.issue?.[0]?.diagnostics ??
      "Merge plan is valid";
    console.log("PREVIEW RESULT", result.value);
    setPreviewResult({ ok: true, message: msg, bundle: bundle ?? null });
  };

  return (
    <div className="w-full p-6">
      <div className="flex flex-row justify-between gap-6">
        {/* Left: comparison grid */}
        <div className="flex-[0_0_65%]">
          <div className="grid grid-cols-[20%_40%_40%] text-xs font-semibold uppercase h-[38px]">
            <div className="flex items-center py-2 px-3">Attributes</div>
            <div className="flex items-center py-2 px-3">
              <RadioGroup
                value={headerSelection}
                onValueChange={(v: string) => selectAll(v as "patient1" | "patient2")}
                className="flex items-center"
              >
                <RadioGroupItem value="patient1" id="header-p1" />
              </RadioGroup>
              <label htmlFor="header-p1" className="ml-2 cursor-pointer">
                Patient 1
              </label>
            </div>
            <div className="flex items-center py-2 px-3">
              <RadioGroup
                value={headerSelection}
                onValueChange={(v: string) => selectAll(v as "patient1" | "patient2")}
                className="flex items-center"
              >
                <RadioGroupItem value="patient2" id="header-p2" />
              </RadioGroup>
              <label htmlFor="header-p2" className="ml-2 cursor-pointer">
                Patient 2
              </label>
            </div>
          </div>
          <div className="rounded-lg overflow-hidden border">
            {FIELDS.map((field) => (
              <Row
                key={field.label}
                label={field.label}
                field1={field.get(patient1)}
                field2={field.get(patient2)}
                selected={field.get(resultPatient)}
                onSelect={(value) => handleSelect(field, value)}
                format={field.format}
              />
            ))}
          </div>
        </div>

        {/* Right: merge result preview */}
        <div className="flex-[0_0_30%]">
          <div className="text-xs font-semibold uppercase h-[38px] flex items-center py-2 px-3">
            Merge Result
          </div>
          <div className="rounded-lg overflow-hidden border-2 border-blue-500">
            {FIELDS.map((field) => (
              <MergeResultRow
                key={field.label}
                value={field.get(resultPatient)}
                active={field.get(patient1) !== field.get(patient2)}
                format={field.format}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6">
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <Button onClick={merge} disabled={isMerging}>
              {isMerging ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Merging...
                </span>
              ) : (
                "Merge"
              )}
            </Button>
            <Button variant="secondary" onClick={preview}>
              Preview
            </Button>
            <Button variant="secondary" asChild>
              <Link to={`/patients/${patient1.id}`}>Cancel</Link>
            </Button>
          </div>
        </div>
        {previewResult && (
          <div className="mt-4">
            <div className={`text-sm font-medium mb-2 ${previewResult.ok ? "text-green-600" : "text-red-600"}`}>
              {previewResult.ok ? "✓ " : "✗ "}{previewResult.message}
            </div>
            {previewResult.ok && previewResult.bundle && previewResult.bundle.entry.length > 0 && (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left py-2 px-3 font-medium w-24">Operation</th>
                      <th className="text-left py-2 px-3 font-medium w-64">Resource</th>
                      <th className="text-left py-2 px-3 font-medium w-32">ifMatch</th>
                      <th className="text-left py-2 px-3 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewResult.bundle.entry.map((entry, i) => {
                      const method = entry.request.method;
                      const resourceType = (entry.resource as any)?.resourceType;
                      const resourceId = (entry.resource as any)?.id;
                      const details = resourceType
                        ? resourceId
                          ? `${resourceType}/${resourceId}`
                          : `New ${resourceType}`
                        : "—";
                      const hasResource = !!entry.resource;
                      return (
                        <tr
                          key={i}
                          className={`border-b last:border-b-0 ${hasResource ? "cursor-pointer hover:bg-muted/40" : ""}`}
                          onClick={() => hasResource && setSelectedEntry(entry)}
                        >
                          <td className="py-2 px-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                method === "DELETE"
                                  ? "bg-red-100 text-red-700"
                                  : method === "POST"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-blue-100 text-blue-700"
                              }`}
                            >
                              {method}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-xs break-all">
                            {entry.request.url}
                          </td>
                          <td className="py-2 px-3 font-mono text-xs text-muted-foreground">
                            {entry.request.ifMatch ?? "—"}
                          </td>
                          <td className="py-2 px-3 text-muted-foreground text-xs">{details}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      <MdmDrawer
        open={!!selectedEntry}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
        title={
          selectedEntry ? (
            <div className="flex items-center gap-3">
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                  selectedEntry.request.method === "DELETE"
                    ? "bg-red-100 text-red-700"
                    : selectedEntry.request.method === "POST"
                      ? "bg-green-100 text-green-700"
                      : "bg-blue-100 text-blue-700"
                }`}
              >
                {selectedEntry.request.method}
              </span>
              <span className="font-mono text-sm">{selectedEntry.request.url}</span>
            </div>
          ) : null
        }
        content={
          selectedEntry?.resource && (
            <pre className="text-xs font-mono p-4 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(selectedEntry.resource, null, 2)}
            </pre>
          )
        }
      >
        <></>
      </MdmDrawer>
    </div>
  );
}
