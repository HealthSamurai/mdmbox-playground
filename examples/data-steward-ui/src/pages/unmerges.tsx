import Layout from "@/components/layout";
import { UnmergesTable } from "@/components/unmerges-table";

export function UnmergesPage() {
  return (
    <Layout
      activeTab="unmerges"
      breadcrumbItems={[{ title: "Unmerges", link: "/unmerges" }]}
    >
      <div className="p-4">
        <UnmergesTable />
      </div>
    </Layout>
  );
}
