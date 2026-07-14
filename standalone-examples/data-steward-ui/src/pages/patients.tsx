import Layout from "@/components/layout";
import { PatientTable } from "@/components/patient-table";

export function PatientsPage() {
  return (
    <Layout
      activeTab="patients"
      breadcrumbItems={[{ title: "Patients", link: "/patients" }]}
    >
      <div className="p-4">
        <PatientTable />
      </div>
    </Layout>
  );
}
