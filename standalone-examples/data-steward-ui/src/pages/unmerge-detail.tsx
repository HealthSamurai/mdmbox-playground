import { useParams, useNavigate } from "react-router";
import { useEffect, useState } from "react";
import Layout from "@/components/layout";
import { Button, MdmDrawer } from "@/components/ui";
import { api } from "@/api/client";
import type { MergeDetail } from "@/api/types";

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
      status === "unmerged"
        ? "bg-orange-100 text-orange-700"
        : "bg-gray-100 text-gray-700"
    }`}
  >
    {status}
  </span>
);

export function UnmergeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<MergeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<{
    title: string;
    body: any;
  } | null>(null);
  const [loadingResource, setLoadingResource] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .getMerge(id)
      .then(setDetail)
      .catch((e) => setError(e?.message ?? "Failed to load unmerge"));
  }, [id]);

  const openResource = async (reference: string) => {
    setSelectedResource({ title: reference, body: null });
    setLoadingResource(true);
    try {
      const body = await api.readResource(reference);
      setSelectedResource({ title: reference, body });
    } catch (e: any) {
      setSelectedResource({ title: reference, body: { error: e?.message ?? "Failed" } });
    } finally {
      setLoadingResource(false);
    }
  };

  if (error) {
    return (
      <Layout
        activeTab="unmerges"
        breadcrumbItems={[
          { title: "Unmerges", link: "/unmerges" },
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
        activeTab="unmerges"
        breadcrumbItems={[
          { title: "Unmerges", link: "/unmerges" },
          { title: id ?? "" },
        ]}
      >
        <div className="p-6">Loading...</div>
      </Layout>
    );
  }

  const task = detail.task;
  const status = task.businessStatus?.coding?.[0]?.code ?? "unknown";
  const sourceRef = task.for?.reference ?? "\u2014";
  const targetRef = task.focus?.reference ?? "\u2014";
  const date = task.authoredOn ? new Date(task.authoredOn).toLocaleString() : "\u2014";
  const recorded = detail.provenance?.recorded
    ? new Date(detail.provenance.recorded).toLocaleString()
    : null;

  return (
    <Layout
      activeTab="unmerges"
      breadcrumbItems={[
        { title: "Unmerges", link: "/unmerges" },
        { title: `${sourceRef} \u2192 ${targetRef}` },
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
          <Button variant="secondary" onClick={() => navigate("/unmerges")}>
            Back to unmerges
          </Button>
        </div>
      </div>

      <MdmDrawer
        open={!!selectedResource}
        onOpenChange={(open) => !open && setSelectedResource(null)}
        title={selectedResource?.title ?? ""}
        content={
          loadingResource ? (
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
