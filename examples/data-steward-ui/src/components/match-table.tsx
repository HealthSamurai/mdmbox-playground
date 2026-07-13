import {
  DataTable,
  TableHeaderContent,
  TableCellContent,
  useTableUiState,
  SimplePagination,
  MatchParams,
} from "@/components/ui";
import { ColumnDef, PaginationState } from "@tanstack/react-table";
import type { PatientRow, PatientMatchRow, MatchingModel } from "@/api/types";
import { useCallback, useRef, useState } from "react";
import { useSearchParams, Link } from "react-router";
import { BarChart3 } from "lucide-react";
import { PatientSummaryDrawer } from "./patient-summary-drawer";
import { MatchChart } from "./match-chart";
import { toUSDate, withDash } from "@/lib/utils";

type SourcePatientInfoProps = {
  patient: PatientRow;
};

function SourcePatientInfo({ patient }: SourcePatientInfoProps) {
  return (
    <div className="w-64 p-6 space-y-3 flex-shrink-0 border-r bg-muted/30">
      <div>
        <div className="text-xs text-muted-foreground">ID</div>
        <div className="text-sm font-medium">{withDash(patient.id)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">First name</div>
        <div className="text-sm font-medium">{withDash(patient.firstname)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Last name</div>
        <div className="text-sm font-medium">{withDash(patient.lastname)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Birth date</div>
        <div className="text-sm font-medium">{withDash(toUSDate(patient.birthdate))}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">Email</div>
        <div className="text-sm font-medium">{withDash(patient.email)}</div>
      </div>
      <div>
        <div className="text-xs text-muted-foreground">City</div>
        <div className="text-sm font-medium">{withDash(patient.city)}</div>
      </div>
    </div>
  );
}

const LOCALSTORAGE_KEY = "match-table-ui-state";

type MatchTableProps = {
  matchPatient: PatientRow;
  data: PatientMatchRow[];
  isLoading: boolean;
  linkageModels: MatchingModel[];
  selectedModel: MatchingModel;
  threshold: number;
  page: number;
  count: number;
};

export function MatchTable(props: MatchTableProps) {
  const [, setSearchParams] = useSearchParams();
  const [selectedPatient, setSelectedPatient] = useState<PatientMatchRow | null>(null);

  const getDifferenceColor = (rowId: string, currentValue: any, pinnedValue: any): string => {
    const isNotPinnedRow = rowId !== props.matchPatient.id;
    const isDifferent = currentValue !== pinnedValue;
    return isNotPinnedRow && isDifferent ? "text-red-600" : "";
  };

  const updateSearchParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams((prev) => {
        if (value === null) prev.delete(key);
        else prev.set(key, value);
        return prev;
      });
    },
    [setSearchParams]
  );

  const handleModelChange = (model: MatchingModel) => {
    updateSearchParam("model-id", model.id);
  };

  const handleThresholdChange = (threshold: number) => {
    updateSearchParam("threshold", threshold.toString());
  };


  const columns = useRef<ColumnDef<PatientMatchRow>[]>([
    {
      accessorKey: "weight",
      header: () => <TableHeaderContent content={"Score"} />,
      cell: ({ row }) => (
        <TableCellContent
          content={
            <div className="flex items-center gap-2 w-full">
              <span>{row.original.weight != null ? row.original.weight.toFixed(2) : ""}</span>
              {row.original.matchDetails && (
                <button
                  type="button"
                  aria-label={row.getIsExpanded() ? "Hide score breakdown" : "Show score breakdown"}
                  className="ml-auto text-muted-foreground hover:text-blue-600 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    row.toggleExpanded();
                  }}
                >
                  <BarChart3 className="h-4 w-4" />
                </button>
              )}
            </div>
          }
        />
      ),
      enablePinning: true,
      enableResizing: true,
    },
    {
      accessorKey: "id",
      header: () => <TableHeaderContent content={"ID"} />,
      cell: ({ row }) => {
        const textColor = getDifferenceColor(row.original.id, row.original.id, props.matchPatient.id);
        return <TableCellContent content={<span className={textColor}>{withDash(row.original.id)}</span>} />;
      },
      enablePinning: true,
      enableResizing: true,
    },
    {
      accessorKey: "firstname",
      header: () => <TableHeaderContent content={"First Name"} />,
      cell: ({ row }) => {
        const textColor = getDifferenceColor(row.original.id, row.original.firstname, props.matchPatient.firstname);
        if (row.original.duplicate)
          return (
            <TableCellContent
              content={
                <div className="flex gap-2">
                  <span className={textColor}>{withDash(row.original.firstname)}</span>
                  <img src="/icons/duplicate-icon.svg" alt="duplicate" className="h-6 w-6" />
                </div>
              }
            />
          );
        return <TableCellContent content={<span className={textColor}>{withDash(row.original.firstname)}</span>} />;
      },
      enablePinning: true,
      enableResizing: true,
    },
    {
      accessorKey: "lastname",
      header: () => <TableHeaderContent content={"Last Name"} />,
      cell: ({ row }) => {
        const textColor = getDifferenceColor(row.original.id, row.original.lastname, props.matchPatient.lastname);
        return <TableCellContent content={<span className={textColor}>{withDash(row.original.lastname)}</span>} />;
      },
      enablePinning: true,
      enableResizing: true,
    },
    {
      accessorKey: "birthdate",
      header: () => <TableHeaderContent content={"Birth date"} />,
      cell: ({ row }) => {
        const textColor = getDifferenceColor(row.original.id, row.original.birthdate, props.matchPatient.birthdate);
        return <TableCellContent content={<span className={textColor}>{withDash(toUSDate(row.original.birthdate))}</span>} />;
      },
      enablePinning: true,
      enableResizing: true,
      minSize: 120,
    },
    {
      accessorKey: "email",
      header: () => <TableHeaderContent content={"Email"} />,
      cell: ({ row }) => {
        const textColor = getDifferenceColor(row.original.id, row.original.email, props.matchPatient.email);
        return <TableCellContent content={<span className={textColor}>{withDash(row.original.email)}</span>} />;
      },
      enablePinning: true,
      enableResizing: true,
    },
    {
      accessorKey: "city",
      header: () => <TableHeaderContent content={"City"} />,
      cell: ({ row }) => {
        const textColor = getDifferenceColor(row.original.id, row.original.city, props.matchPatient.city);
        return <TableCellContent content={<span className={textColor}>{withDash(row.original.city)}</span>} />;
      },
      enablePinning: true,
      enableResizing: true,
    },
    {
      id: "actions",
      header: () => <TableHeaderContent content={"Actions"} />,
      cell: ({ row }) =>
        row.original.id === props.matchPatient.id ? (
          <TableCellContent content={<div></div>} />
        ) : (
          <TableCellContent
            content={
              <Link
                to={`/merge?sourceId=${props.matchPatient.id}&targetId=${row.original.id}&model=${props.selectedModel?.id || ""}`}
                className="text-blue-600 hover:text-blue-800"
                onClick={(e) => e.stopPropagation()}
              >
                Merge
              </Link>
            }
          />
        ),
      enablePinning: true,
    },
  ]);

  const { uiState: initialUiState, handleUiChange } = useTableUiState(LOCALSTORAGE_KEY, {
    columnOrder: [],
    columnPinning: { right: ["actions"] },
    columnSizing: {},
    columnVisibility: {},
    drawerWidth: 0.4,
  });

  const fetchPatients = (pagination: PaginationState) => {
    setSearchParams((prev) => {
      prev.set("page", pagination.pageIndex.toString());
      prev.set("count", pagination.pageSize.toString());
      return prev;
    });
  };

  return (
    <PatientSummaryDrawer
      patientId={selectedPatient?.id}
      firstName={selectedPatient?.firstname}
      lastName={selectedPatient?.lastname}
      selectedPatient={!!selectedPatient}
      setSelectedPatient={setSelectedPatient}
      defaultWidth={initialUiState?.drawerWidth}
      onWidthChange={(w) => initialUiState && handleUiChange({ ...initialUiState, drawerWidth: w })}
    >
      <div className="flex h-full">
        <SourcePatientInfo patient={props.matchPatient} />
        <div className="flex-1 min-w-0">
          <div className="px-4 pt-4 pb-4">
            <MatchParams
              linkageModels={props.linkageModels}
              selectedModel={props.selectedModel}
              threshold={props.threshold}
              showNonDuplicates={false}
              episodeNumber=""
              onModelChange={handleModelChange}
              onThresholdChange={handleThresholdChange}
              onShowNonDuplicatesChange={() => {}}
              onEpisodeNumberChange={() => {}}
              withEncountersSearch={false}
              withNonDuplicatesSwithch={false}
              withThresholdSlider={true}
            />
          </div>
          {initialUiState && (
            <div className="px-4">
              <DataTable
                // Remount the table when the model/threshold changes so any
                // expanded score-breakdown charts collapse (the table owns the
                // expanded state internally and wouldn't reset on its own).
                key={`${props.selectedModel?.id ?? ""}:${props.threshold}`}
                columns={columns.current}
                pageSize={props.count}
                pageIndex={props.page - 1}
                isLoading={props.isLoading}
                data={props.data}
                onRowClick={setSelectedPatient}
                onPaginationChange={fetchPatients}
                showZebraStripes={true}
                enableColumnReordering={true}
                getRowId={(x: any) => x.id}
                onUiChange={handleUiChange}
                initialUiState={initialUiState}
                paginationComponent={SimplePagination}
                expandedRows
                ExpandedRowContent={(row) =>
                  row.row.matchDetails ? (
                    <div className="mx-auto max-w-3xl">
                      <MatchChart data={row.row.matchDetails} />
                    </div>
                  ) : null
                }
              />
            </div>
          )}
        </div>
      </div>
    </PatientSummaryDrawer>
  );
}
