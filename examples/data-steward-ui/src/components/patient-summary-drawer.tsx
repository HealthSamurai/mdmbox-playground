import { MdmDrawer } from "@/components/ui";
import { PatientSummary } from "./patient-summary";

type PatientSummaryDrawerProps = {
  patientId?: string;
  firstName?: string;
  lastName?: string;
  children: React.ReactNode;
  footerChildren?: React.ReactNode;
  selectedPatient: boolean;
  setSelectedPatient: (p: null) => void;
  defaultWidth?: number;
  onWidthChange?: (width: number) => void;
};

export function PatientSummaryDrawer(props: PatientSummaryDrawerProps) {
  return (
    <MdmDrawer
      open={!!props.selectedPatient}
      onOpenChange={() => props.setSelectedPatient(null)}
      defaultWidth={props.defaultWidth}
      onWidthChange={props.onWidthChange}
      title={
        <div className="flex justify-between items-center w-full pr-18">
          <span>
            {props.firstName?.toUpperCase() || ""}{" "}
            {props.lastName?.toUpperCase() || ""}
          </span>
        </div>
      }
      content={props.patientId && <PatientSummary patientId={props.patientId} />}
      footer={props.footerChildren}
    >
      {props.children}
    </MdmDrawer>
  );
}
