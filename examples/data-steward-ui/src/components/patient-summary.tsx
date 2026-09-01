import type { PatientFullInfo, PatientSummary as PatientSummaryType } from "@/api/types";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { toast, FieldDisplay, MdmTabs as Tabs } from "@/components/ui";
import { toUSformat, toUSDate } from "@/lib/utils";

type PatientInfoProps = {
  patient: PatientSummaryType;
};

function PatientInfo({ patient }: PatientInfoProps) {
  return (
    <div className="p-6">
      <div className="space-y-2 text-text-secondary">
        <FieldDisplay label="ID" value={patient.id} />
        <FieldDisplay
          label="First name"
          value={patient.givenNames ? patient.givenNames.join(" ") : ""}
        />
        <FieldDisplay label="Last name" value={patient.family} />
        <FieldDisplay label="Birth date" value={toUSDate(patient.birthDate)} />
        <FieldDisplay label="Email" value={patient.email} />
        <FieldDisplay label="City" value={patient.city} />
        <FieldDisplay label="Created" value={toUSformat(patient.createdAt)} />
        <FieldDisplay
          label="Last Updated"
          value={toUSformat(patient.updatedAt ?? patient.createdAt)}
        />
      </div>
    </div>
  );
}

type PatientSummaryProps = {
  patientId: string;
};

export function PatientSummary({ patientId }: PatientSummaryProps) {
  const [patient, setPatient] = useState<PatientFullInfo>();

  useEffect(() => {
    api
      .getPatientSummary(patientId)
      .then(setPatient)
      .catch((error) => {
        toast.error({
          title: "Failed to load patient summary",
          description:
            error?.body?.issue?.[0]?.diagnostics ||
            error?.message ||
            "An unexpected error occurred",
        });
      });
  }, [patientId]);

  if (!patient) return null;

  return (
    <Tabs
      defaultValue="summary"
      tabs={[
        {
          id: "summary",
          label: "Summary",
          content: <PatientInfo patient={patient.summary} />,
        },
      ]}
    />
  );
}
