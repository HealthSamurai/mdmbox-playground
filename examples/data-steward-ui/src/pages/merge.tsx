import { useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import Layout from "@/components/layout";
import { MergeGrid } from "@/components/merge-grid";
import { api } from "@/api/client";
type MergePairData = {
  sourcePatient: Record<string, unknown>;
  targetPatient: Record<string, unknown>;
};

export function MergePage() {
  const [searchParams] = useSearchParams();
  const sourceId = searchParams.get("sourceId") || "";
  const targetId = searchParams.get("targetId") || "";

  const [mergePair, setMergePair] = useState<MergePairData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId || !targetId) return;
    api
      .getMergePair({ sourceId, targetId })
      .then(setMergePair)
      .catch((e) => setError(e.message));
  }, [sourceId, targetId]);

  if (!sourceId || !targetId) {
    return (
      <Layout breadcrumbItems={[{ title: "Patients", link: "/patients" }, { title: "Merge" }]}>
        <div className="p-6 text-red-600">Missing sourceId or targetId</div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout breadcrumbItems={[{ title: "Patients", link: "/patients" }, { title: "Merge" }]}>
        <div className="p-6 text-red-600">Error: {error}</div>
      </Layout>
    );
  }

  if (!mergePair) {
    return (
      <Layout breadcrumbItems={[{ title: "Patients", link: "/patients" }, { title: "Merge" }]}>
        <div className="p-6">Loading...</div>
      </Layout>
    );
  }

  const p1Name = (mergePair.sourcePatient as any).name?.[0];
  const p2Name = (mergePair.targetPatient as any).name?.[0];
  const title = `Merge: ${p1Name?.given?.[0] ?? ""} ${p1Name?.family ?? ""} & ${p2Name?.given?.[0] ?? ""} ${p2Name?.family ?? ""}`;

  return (
    <Layout
      breadcrumbItems={[
        { title: "Patients", link: "/patients" },
        { title },
      ]}
    >
      <MergeGrid
        patient1={mergePair.sourcePatient}
        patient2={mergePair.targetPatient}
      />
    </Layout>
  );
}
