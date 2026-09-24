import { PatientDetails } from "./PatientDetails";

export default async function PatientPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  return <PatientDetails kind={kind} id={id} />;
}
