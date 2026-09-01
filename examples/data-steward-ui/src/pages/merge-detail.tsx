import { useParams, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import Layout from "@/components/layout";
import { Button, MdmDrawer, toast } from "@/components/ui";
import { Loader2 } from "lucide-react";
import { api } from "@/api/client";
import type { MergeDetail } from "@/api/types";
import type { MergePlanEntry, TransactionBundle } from "mdmbox-sdk";

const RoleBadge = ({ role }: { role: string }) => {
  const color =
    role === "removal"
      ? "bg-red-100 text-red-700"
      : role === "revision"
        ? "bg-blue-100 text-blue-700"
        : "bg-gray-100 text-gray-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {role}
    </span>
  );
};

const StatusBadge = ({ status }: { status: string }) => (
  <span
    className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
      status === "merged"
        ? "bg-blue-100 text-blue-700"
        : "bg-gray-100 text-gray-700"
    }`}
  >
    {status}
  </span>
);

export function MergeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<MergeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<{
    title: string;
    body: any;
  } | null>(null);
  const [loadingResource, setLoadingResource] = useState(false);
  const [isUnmerging, setIsUnmerging] = useState(false);
  const [unmergePreview, setUnmergePreview] = useState<{
    ok: boolean;
    message: string;
    bundle: TransactionBundle | null;
  } | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<MergePlanEntry | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getMerge(id)
      .then(setDetail)
      .catch((e) => setError(e?.message ?? "Failed to load merge"));
  }, [id]);

  const openResource = async (reference: string) => {
    setSelectedResource({ title: reference, body: null });
    setLoadingResource(true);
    try {
      // reference like "Patient/123/_history/3" or "Patient/123"
      const body = await api.readResource(reference);
      setSelectedResource({ title: reference, body });
    } catch (e: any) {
      setSelectedResource({ title: reference, body: { error: e?.message ?? "Failed" } });
    } finally {
      setLoadingResource(false);
    }
  };

  const handleUnmergePreview = async () => {
    if (!detail) return;
    setUnmergePreview(null);
    try {
      const plan = await api.buildUnmergePlan(detail);
      const response = await api.unmergePreview(plan);
      const { outcome, bundle } = response.resource;
      const msg =
        outcome?.issue?.[0]?.details?.text ??
        outcome?.issue?.[0]?.diagnostics ??
        "Unmerge plan is valid";
      setUnmergePreview({ ok: true, message: msg, bundle: bundle ?? null });
    } catch (e: any) {
      const msg = e?.message ?? "Failed to build unmerge plan";
      setUnmergePreview({ ok: false, message: msg, bundle: null });
      toast.error({ title: "Preview failed", description: msg });
    }
  };

  const handleUnmerge = async () => {
    if (!detail) return;
    setIsUnmerging(true);
    try {
      const plan = await api.buildUnmergePlan(detail);
      await api.unmerge(plan);
      toast.success({ title: "Unmerge completed" });
      navigate("/merges");
    } catch (e: any) {
      toast.error({ title: "Unmerge failed", description: e?.message ?? "Unknown error" });
    } finally {
      setIsUnmerging(false);
    }
  };

  if (error) {
    return (
      <Layout
        activeTab="merges"
        breadcrumbItems={[
          { title: "Merges", link: "/merges" },
          { title: id ?? "" },
        ]}
      >
        <div className="p-6 text-red-600">{error}</div>
      </Layout>
    );
  }

  if (!detail) {
    return (
      <Layout
        activeTab="merges"
        breadcrumbItems={[
          { title: "Merges", link: "/merges" },
          { title: id ?? "" },
        ]}
      >
        <div className="p-6">Loading...</div>
      </Layout>
    );
  }

  const task = detail.task;
  const status = task.businessStatus?.coding?.[0]?.code ?? "unknown";
  const sourceRef = task.for?.reference ?? "—";
  const targetRef = task.focus?.reference ?? "—";
  const date = task.authoredOn ? new Date(task.authoredOn).toLocaleString() : "—";
  const recorded = detail.provenance?.recorded
    ? new Date(detail.provenance.recorded).toLocaleString()
    : null;

  return (
    <Layout
      activeTab="merges"
      breadcrumbItems={[
        { title: "Merges", link: "/merges" },
        { title: `${sourceRef} → ${targetRef}` },
      ]}
    >
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="rounded-lg border p-4 bg-muted/30 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="mt-1"><StatusBadge status={status} /></div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Date</div>
            <div className="text-sm font-medium">{date}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Source</div>
            <div className="text-sm font-mono">{sourceRef}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Target</div>
            <div className="text-sm font-mono">{targetRef}</div>
          </div>
          {recorded && (
            <div>
              <div className="text-xs text-muted-foreground">Provenance recorded</div>
              <div className="text-sm">{recorded}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-muted-foreground">Task ID</div>
            <div className="text-sm font-mono">{task.id}</div>
          </div>
        </div>

        {/* Affected resources */}
        <div>
          <h3 className="text-sm font-semibold mb-2">Affected resources</h3>
          {detail.entities.length === 0 && detail.createdRefs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No provenance entities found</div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b">
                    <th className="text-left py-2 px-3 font-medium w-32">Role</th>
                    <th className="text-left py-2 px-3 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.entities.map((e, i) => (
                    <tr
                      key={`e-${i}`}
                      className="border-b last:border-b-0 cursor-pointer hover:bg-muted/40"
                      onClick={() => openResource(e.what)}
                    >
                      <td className="py-2 px-3">
                        <RoleBadge role={e.role} />
                      </td>
                      <td className="py-2 px-3 font-mono text-xs break-all">{e.what}</td>
                    </tr>
                  ))}
                  {detail.createdRefs.map((ref, i) => (
                    <tr
                      key={`c-${i}`}
                      className="border-b last:border-b-0 cursor-pointer hover:bg-muted/40"
                      onClick={() => openResource(ref)}
                    >
                      <td className="py-2 px-3">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                          created
                        </span>
                      </td>
                      <td className="py-2 px-3 font-mono text-xs break-all">{ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {status === "merged" && (
            <>
              <Button onClick={handleUnmerge} disabled={isUnmerging}>
                {isUnmerging ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Unmerging...
                  </span>
                ) : (
                  "Unmerge"
                )}
              </Button>
              <Button variant="secondary" onClick={handleUnmergePreview}>
                Preview Unmerge
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={() => navigate("/merges")}>
            Back to merges
          </Button>
        </div>

        {/* Unmerge preview */}
        {unmergePreview && (
          <div className="mt-4">
            <div className={`text-sm font-medium mb-2 ${unmergePreview.ok ? "text-green-600" : "text-red-600"}`}>
              {unmergePreview.ok ? "\u2713 " : "\u2717 "}{unmergePreview.message}
            </div>
            {unmergePreview.ok && unmergePreview.bundle && unmergePreview.bundle.entry.length > 0 && (
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
                    {unmergePreview.bundle.entry.map((entry, i) => {
                      const method = entry.request.method;
                      const resourceType = (entry.resource as any)?.resourceType;
                      const resourceId = (entry.resource as any)?.id;
                      const details = resourceType
                        ? resourceId
                          ? `${resourceType}/${resourceId}`
                          : `New ${resourceType}`
                        : "\u2014";
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
                            {entry.request.ifMatch ?? "\u2014"}
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
        open={!!selectedResource || !!selectedEntry}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedResource(null);
            setSelectedEntry(null);
          }
        }}
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
          ) : (
            selectedResource?.title ?? ""
          )
        }
        content={
          selectedEntry?.resource ? (
            <pre className="text-xs font-mono p-4 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(selectedEntry.resource, null, 2)}
            </pre>
          ) : loadingResource ? (
            <div className="p-4 text-sm text-muted-foreground">Loading...</div>
          ) : (
            <pre className="text-xs font-mono p-4 overflow-auto whitespace-pre-wrap break-all">
              {selectedResource?.body
                ? JSON.stringify(selectedResource.body, null, 2)
                : ""}
            </pre>
          )
        }
      >
        <></>
      </MdmDrawer>
    </Layout>
  );
}
