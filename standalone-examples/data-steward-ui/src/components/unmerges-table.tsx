import {
  DataTable,
  ColumnFilterConfig,
  TableHeaderContent,
  TableCellContent,
  useTableUiState,
  SimplePagination,
} from "@/components/ui";
import {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
} from "@tanstack/react-table";
import type { MergeTaskRow, GetMergesFilter, MergeStatus } from "@/api/types";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { api } from "@/api/client";
import { paramsToObject, withDash } from "@/lib/utils";

const LOCALSTORAGE_KEY = "unmerges-table-ui-state";

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

const columns: ColumnDef<MergeTaskRow>[] = [
  {
    accessorKey: "status",
    header: () => <TableHeaderContent content={"Status"} />,
    cell: ({ row }) => (
      <TableCellContent content={<StatusBadge status={row.original.status} />} />
    ),
    enablePinning: true,
    enableResizing: true,
  },
  {
    accessorKey: "source",
    header: () => <TableHeaderContent content={"Source"} />,
    cell: ({ cell }) => (
      <TableCellContent content={withDash(cell.getValue() as string)} />
    ),
    enablePinning: true,
    enableResizing: true,
  },
  {
    accessorKey: "target",
    header: () => <TableHeaderContent content={"Target"} />,
    cell: ({ cell }) => (
      <TableCellContent content={withDash(cell.getValue() as string)} />
    ),
    enablePinning: true,
    enableResizing: true,
  },
  {
    accessorKey: "date",
    header: () => <TableHeaderContent content={"Date"} />,
    cell: ({ cell }) => {
      const v = cell.getValue() as string | undefined;
      return <TableCellContent content={withDash(v ? new Date(v).toLocaleString() : "")} />;
    },
    enablePinning: true,
    enableResizing: true,
  },
  {
    accessorKey: "id",
    header: () => <TableHeaderContent content={"Task ID"} />,
    cell: ({ cell }) => (
      <TableCellContent content={withDash(cell.getValue() as string)} />
    ),
    enablePinning: true,
    enableResizing: true,
  },
];

const searchParamsToFilter = (params: ReturnType<typeof paramsToObject>): GetMergesFilter => ({
  status: (params.status as MergeStatus) || undefined,
  source: (params.source as string) || undefined,
  target: (params.target as string) || undefined,
  startDate: (params.startDate as string) || undefined,
  endDate: (params.endDate as string) || undefined,
});

export function UnmergesTable() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<MergeTaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const params = paramsToObject(searchParams);
  const filters = searchParamsToFilter(params);
  const page = parseInt((params.page as string) || "1");
  const count = parseInt((params.count as string) || "10");

  const { uiState: initialUiState, handleUiChange } = useTableUiState(
    LOCALSTORAGE_KEY,
    {
      columnOrder: [],
      columnPinning: {},
      columnSizing: {},
      columnVisibility: {},
      drawerWidth: 0.4,
    }
  );

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.getUnmerges({ page, count, filter: filters });
      setData(result.items);
    } catch (e) {
      console.error("Failed to load unmerges", e);
    } finally {
      setIsLoading(false);
    }
  }, [searchParams.toString()]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filterConfig: ColumnFilterConfig = [
    {
      enabled: true,
      columnId: "status",
      type: "text",
      placeholder: "Status",
      value: filters.status,
    },
    {
      enabled: true,
      columnId: "source",
      type: "text",
      placeholder: "Patient/123",
      value: filters.source,
    },
    {
      enabled: true,
      columnId: "target",
      type: "text",
      placeholder: "Patient/456",
      value: filters.target,
    },
    {
      enabled: true,
      columnId: "date",
      type: "date",
      placeholder: "Date >= ",
      value: filters.startDate ? new Date(filters.startDate) : undefined,
    },
    {
      enabled: true,
      columnId: "id",
      type: "text",
      placeholder: "Search",
    },
  ];

  const updateFilter = (columnFilters: ColumnFiltersState) => {
    const next = new URLSearchParams();
    columnFilters.forEach((f) => {
      const map: Record<string, string> = {
        status: "status",
        source: "source",
        target: "target",
        date: "startDate",
      };
      const key = map[f.id];
      if (key) next.set(key, String(f.value));
    });
    next.set("page", "1");
    next.set("count", "10");
    setSearchParams(next);
  };

  const fetchPage = (pagination: PaginationState) => {
    setSearchParams((prev) => {
      prev.set("page", pagination.pageIndex.toString());
      prev.set("count", pagination.pageSize.toString());
      return prev;
    });
  };

  return (
    initialUiState && (
      <DataTable
        columns={columns}
        data={data}
        isLoading={isLoading}
        pageSize={count}
        pageIndex={page - 1}
        onFilter={updateFilter}
        onCellClick={(row) => navigate(`/unmerges/${row.id}`)}
        onPaginationChange={fetchPage}
        filterConfig={filterConfig}
        showZebraStripes={true}
        enableColumnReordering={true}
        onUiChange={handleUiChange}
        initialUiState={initialUiState}
        paginationComponent={SimplePagination}
      />
    )
  );
}
