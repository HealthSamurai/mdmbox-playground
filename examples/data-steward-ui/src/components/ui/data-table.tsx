
import { useCallback, useMemo, useState, CSSProperties, MouseEventHandler, ReactNode, useEffect, useRef } from "react";
import { format, parse, isValid } from "date-fns";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@health-samurai/react-components";
import {
  Column,
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnPinningState,
  Header,
  flexRender,
  getCoreRowModel,
  useReactTable,
  Table as TanstackTable,
  PaginationState,
  ColumnPinningPosition,
  SortingState,
  RowPinningState,
  ColumnSizingState,
  Row,
  VisibilityState,
  getExpandedRowModel
} from "@tanstack/react-table";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronDown,
  ChevronUp,
  GripVertical,
  MoreHorizontal,
  PinOff,
  EyeOff,
} from "lucide-react";
import { cn } from "./utils";
import { SearchIcon } from "./icons";
import { DatePicker } from "./date-picker"
import { DateRangePicker } from "./daterange-picker"
import React from "react";

const styles = {
  tableContainer: cn(
    "block",
    "w-full",
    "overflow-x-auto",
    "border",
    "border-border-secondary",
    "rounded-md",
  ),
  table: cn(
    "w-full",
    "table-fixed",
    "border-collapse",
    "text-sm",
    "[&_td]:border-border",
    "[&_th]:border-border",
    "border-separate",
    "border-spacing-0",
    "[&_tfoot_td]:border-t",
    "[&_th]:border-b",
    "[&_tr]:border-none",
  ),
  cellPadding: cn("px-4"),
  pinnedColumn: cn(
    "data-pinned:bg-background/90",
    "data-pinned:backdrop-blur-xs",
    "[&[data-pinned=left][data-last-col=left]]:border-r",
    "[&[data-pinned=left][data-last-col=left]]:border-r-border-primary",
    "[&[data-pinned=right][data-last-col=right]]:border-l",
    "[&[data-pinned=right][data-last-col=right]]:border-l-border-primary",
  ),
  pinnedHeader: cn(
    "data-pinned:bg-muted/90",
    "data-pinned:backdrop-blur-xs",
    "[&[data-pinned=left][data-last-col=left]]:border-r",
    "[&[data-pinned=left][data-last-col=left]]:border-r-border-primary",
    "[&[data-pinned=right][data-last-col=right]]:border-l",
    "[&[data-pinned=right][data-last-col=right]]:border-l-border-primary",
  ),
  thead: cn("bg-bg-secondary"),
  th: cn("h-8", "text-left", "font-medium", "text-text-primary", "select-none"),
  thSortable: cn("cursor-pointer", "hover:bg-bg-tertiary"),
  thSorted: cn("bg-bg-link/3", "border-b", "border-border-link"),
  thRightAlign: cn("text-right"),
  cellSorted: cn("bg-bg-link/3"),
  headerContent: cn(
    "h-8",
    "flex",
    "items-center",
    "justify-between",
    "typo-body",
    "text-text-secondary",
    "relative",
    "w-full",
  ),
  headerText: cn(""),
  headerIcons: cn("flex", "flex-col", "items-center", "justify-center"),
  headerIcon: cn("w-3", "h-3"),
  headerIconInactive: cn("w-3", "h-3", "opacity-30"),
  cellContent: cn("h-8", "flex", "items-center", "text-text-primary"),
  cellText: cn("truncate"),
  cellCode: cn("h-8", "flex", "items-center", "text-text-primary", "typo-code"),
  cellRightAlign: cn("justify-end"),
  cellTextRightAlign: cn("text-right"),
  filterRow: cn("bg-white", "border-b", "border-border-secondary"),
  filterCell: cn("px-1", "h-8"),
  filterCellPinned: cn("px-1", "h-8", "bg-white/90", "backdrop-blur-xs"),
  filterActions: cn("text-text-tertiary", "text-sm"),
  filterInput: cn("border-0", "h-8"),
  filterIcon: cn("w-4", "h-4", "text-text-tertiary"),
  dataRow: cn("hover:bg-bg-link/10"),
  dataRowZebra: cn("bg-bg-secondary", "hover:bg-bg-link/10"),
  blurRow: cn(
    "relative",
  ),
  dataCell: cn("h-8"),
  actionButton: cn(
    "text-text-link",
    "hover:text-text-link_hover",
    "transition-colors",
    "cursor-pointer",
  ),
  actionLink: cn(
    "text-text-link",
    "hover:text-text-link_hover",
    "transition-colors",
    "cursor-pointer",
  ),
  resizeHandle: cn(
    "absolute",
    "right-0",
    "top-0",
    "h-full",
    "w-1",
    "px-1",
    "bg-border-primary",
    "cursor-col-resize",
    "user-select-none",
    "touch-action-none",
    "opacity-0",
    "hover:opacity-100",
    "active:opacity-100",
    "transition-opacity",
    "duration-150",
    "before:absolute",
    "before:right-[-4px]",
    "before:top-0",
    "before:w-2",
    "before:h-full",
    "before:content-['']",
  ),
  resizeHandleActive: cn("opacity-100", "bg-border-link"),
  resizableHeader: cn(
    "group-hover:[&:not(:last-child)]:after:opacity-30",
    "after:absolute",
    "after:right-0",
    "after:top-1/2",
    "after:-translate-y-1/2",
    "after:h-4",
    "after:w-px",
    "after:bg-border-primary",
    "after:opacity-0",
    "after:transition-opacity",
    "after:duration-150",
    "hover:after:opacity-50",
    "last:after:w-0",
  ),
  draggableHeader: cn("transition-all", "duration-150", "group/header"),
  dragZone: cn(
    "absolute",
    "left-0",
    "top-0",
    "h-full",
    "cursor-grab",
    "active:cursor-grabbing",
    "flex",
    "items-center",
    "justify-start",
    "pl-0",
    "opacity-0",
    "hover:opacity-100",
    "group-hover/header:opacity-60",
    "hover:!opacity-100",
    "transition-opacity",
    "duration-150",
    "bg-transparent",
    "border-none",
    "text-text-tertiary",
    "hover:text-text-secondary",
    "right-5",
  ),
  draggingHeader: cn(
    "bg-bg-primary_inverse/10",
    "scale-105",
    "shadow-lg",
    "z-50",
  ),
  draggingColumn: cn("bg-bg-primary_inverse/10", "shadow-inner"),
  dropZone: cn(
    "relative",
    "before:absolute",
    "before:left-0",
    "before:top-0",
    "before:w-1",
    "before:h-full",
    "before:bg-border-link",
    "before:opacity-0",
    "before:transition-opacity",
    "before:duration-150",
  ),
  dropZoneActive: cn("before:opacity-100"),
} as const;

const getPinningStyles = <T,>(column: Column<T>): CSSProperties => {
  const isPinned = column.getIsPinned();
  return {
    left: isPinned === "left" ? `${column.getStart("left")}px` : undefined,
    right: isPinned === "right" ? `${column.getAfter("right")}px` : undefined,
    position: isPinned ? "sticky" : "relative",
    zIndex: isPinned ? 1 : 0,
  };
};

const Table = ({ className, ...props }: React.ComponentProps<"table">) => (
  <table className={className} {...props} />
);

const TableHeader = ({
  className,
  ...props
}: React.ComponentProps<"thead">) => <thead className={className} {...props} />;

type TableBodyProps<T> = {
  showFilters: boolean
  table: TanstackTable<T>
  pinnedRows?: PinnedRows
  draggedColumn: string | null;
  dropTarget: string | null;
  filterConfigMap: Map<string, FilterConfig>;
  handleRowClick?: (row: T) => MouseEventHandler<HTMLTableRowElement>
  onCellClick?: (data: T, columnId: string) => void
  showZebraStripes: boolean;
  isLoading?: boolean;
  onFilter?: () => void;
  blurStartLine?: number;
  expandedRows?:boolean
  ExpandedRowContent?: React.FC<{ row: T }>
} & React.ComponentProps<"tbody">

const TableBody = <TData, _>({
  table,
  pinnedRows,
  showFilters,
  draggedColumn,
  dropTarget,
  filterConfigMap,
  handleRowClick,
  onCellClick,
  showZebraStripes,
  isLoading = false,
  onFilter,
  className,
  blurStartLine,
  expandedRows,
  ExpandedRowContent,
  ...props
}: TableBodyProps<TData>) => {
  if (pinnedRows) {
    return <tbody className={className} {...props}>
      {showFilters && filterConfigMap.size > 0 && (
        <FilterRow
          headers={table.getHeaderGroups()[0]?.headers || []}
          draggedColumn={draggedColumn}
          dropTarget={dropTarget}
          filterConfigMap={filterConfigMap}
          submitFilter={onFilter}
        />
      )}
      {table.getTopRows().map((row, rowIndex) =>
        <TableRow
          key={`row-${row.id}`}
          row={row}
          isLoading={isLoading}
          isBlur={false}
          onClick={handleRowClick && handleRowClick(row.original)}
          onCellClick={onCellClick}
          draggedColumn={draggedColumn}
          dropTarget={dropTarget}
          showZebraStripes={showZebraStripes}
          rowIndex={rowIndex}
          showFilters={showFilters}
        />
      )}
      <GapRow table={table}>
        {pinnedRows.gap ? pinnedRows.gap : <span />}
      </GapRow>
      {table.getCenterRows().map((row, rowIndex) =>
        <TableRow
          key={`row-${row.id}`}
          row={row}
          isBlur={false}
          isLoading={isLoading}
          onClick={handleRowClick && handleRowClick(row.original)}
          onCellClick={onCellClick}
          draggedColumn={draggedColumn}
          dropTarget={dropTarget}
          showZebraStripes={showZebraStripes}
          rowIndex={rowIndex}
          showFilters={showFilters}
        />
      )}
    </tbody>
  } else {
    const rows = table.getRowModel().rows;
    const isBlur = (rowIndex:number) => {
      return blurStartLine !== undefined && rowIndex >= blurStartLine
    }

    return <tbody className={className} {...props}>
      {showFilters && filterConfigMap.size > 0 && (
        <FilterRow
          headers={table.getHeaderGroups()[0]?.headers || []}
          draggedColumn={draggedColumn}
          dropTarget={dropTarget}
          filterConfigMap={filterConfigMap}
          submitFilter={onFilter}
        />
      )}
      {rows.length === 0 ? (
        isLoading ? (
          // Show 3 skeleton rows when loading with no data
          [...Array(3)].map((_, index) => (
            <tr key={`skeleton-${index}`} className={cn(styles.dataRow, showZebraStripes && index % 2 === (showFilters ? 0 : 1) && styles.dataRowZebra)}>
              {table.getVisibleFlatColumns().map((column) => (
                <TableCell
                  key={`skeleton-${index}-${column.id}`}
                  column={column}
                  draggedColumn={draggedColumn}
                  dropTarget={dropTarget}
                >
                  <Skeleton className="h-5 w-full" />
                </TableCell>
              ))}
            </tr>
          ))
        ) : (
          <GapRow table={table}>
            <span>No data</span>
          </GapRow>
        )
      ) : (
        rows.map((row, rowIndex) =>
          <React.Fragment key={`row-${row.id}`}>
            <TableRow
                row={row}
                isLoading={isLoading}
                onClick={handleRowClick && ((e) => handleRowClick(row.original)(e))}
                onCellClick={onCellClick}
                draggedColumn={draggedColumn}
                dropTarget={dropTarget}
                showZebraStripes={showZebraStripes}
                rowIndex={rowIndex}
                showFilters={showFilters}
                isBlur={isBlur(rowIndex)}
            />
            {expandedRows && row.getIsExpanded() && ExpandedRowContent && (
                <tr className={cn(isBlur(rowIndex) && styles.blurRow)}>
                  <td colSpan={row.getVisibleCells().length} className={cn("p-4", isBlur(rowIndex) && 'blur-[6px] select-none')}>
                    <ExpandedRowContent row={row.original}/>
                  </td>
                </tr>
            )}
          </React.Fragment>
        )
      )}
    </tbody>
  }
}


type TableRowProps<T> = {
  row: Row<T>
  isLoading: boolean
  onClick?: MouseEventHandler<HTMLTableRowElement>
  onCellClick?: (data: T, columnId: string) => void
  draggedColumn: string | null
  dropTarget: string | null
  showZebraStripes: boolean
  rowIndex: number
  showFilters: boolean
  isBlur: boolean
} & Omit<React.ComponentProps<"tr">, 'onClick'>

const TableRow = <TData, _>({
  row,
  isLoading,
  onClick,
  onCellClick,
  draggedColumn,
  dropTarget,
  showZebraStripes,
  rowIndex,
  showFilters,
  className,
  isBlur,
  ...props
}: TableRowProps<TData>) => {
  const cells = row.getVisibleCells();

  return (
    <tr
      className={cn(
        styles.dataRow,
        showZebraStripes &&
        rowIndex % 2 === (showFilters ? 0 : 1) &&
        styles.dataRowZebra,
        isBlur && styles.blurRow,
        className
      )}
      onClick={onClick}
      {...props}
    >
      {isLoading ? (
        cells.map((cell) => (
          <TableCell
            key={cell.id}
            column={cell.column}
            draggedColumn={draggedColumn}
            dropTarget={dropTarget}
          >
            <Skeleton className="h-5 w-full" />
          </TableCell>
        ))
      ) : (
        cells.map((cell) => (
          <TableCell
            className={cn(
              styles.cellPadding,
              isBlur && 'blur-[6px] select-none'
            )}
            key={cell.id}
            column={cell.column}
            draggedColumn={draggedColumn}
            dropTarget={dropTarget}
            onClick={() => onCellClick && onCellClick(row.original, cell.column.id)}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        ))
      )}
    </tr>
  )
};

type GapRowProps<T> = {
  table: TanstackTable<T>
} & React.ComponentProps<"tr">

const GapRow = <T, _>({ content, table, className, children, ...props }: GapRowProps<T>) => {
  return (
    <tr className={className} {...props}>
      <td
        colSpan={table.getVisibleFlatColumns().length}
        className="text-center py-4 text-gray-500"
      >
        {children}
      </td>
    </tr>
  );
}

export type TableHeaderSortProps = {
  isSorted: false | "asc" | "desc";
}

const TableHeaderSort = ({ isSorted }: TableHeaderSortProps) => {
  return (
    <div className={styles.headerIcons}>
      {isSorted === "asc" ? (
        <ChevronUp className={styles.headerIcon} />
      ) : isSorted === "desc" ? (
        <ChevronDown className={styles.headerIcon} />
      ) : (
        <div className="flex flex-col">
          <ChevronUp className={styles.headerIconInactive} />
          <ChevronDown className={styles.headerIconInactive} />
        </div>
      )}
    </div>
  );
}

export type TableHeaderResizeProps<T> = {
  header: Header<T, unknown>;
  position?: "left" | "right";
}

const TableHeaderResize = <TData, _>({ header, position = "right" }: TableHeaderResizeProps<TData>) => {
  if (!header.column.columnDef.enableResizing || !header.column.getCanResize()) {
    return null;
  }

  const isReversed = position === "left";

  const handleResize = (e: React.MouseEvent | React.TouchEvent) => {

    e.preventDefault();
    e.stopPropagation();

    const startX = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const startWidth = header.getSize();

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      const currentX = 'touches' in moveEvent ? moveEvent.touches[0]?.clientX ?? 0 : moveEvent.clientX;
      const delta = startX - currentX; // reversed: moving left increases size
      const newWidth = Math.max(50, startWidth + delta);
      header.column.getLeafColumns().forEach(column => {
        column.columnDef.size = newWidth;
      });
      header.getContext().table.setColumnSizing(prev => ({
        ...prev,
        [header.column.id]: newWidth
      }));
    };

    const onEnd = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);

  };

  return (
    <div
      data-resize-handle
      {...{
        onMouseDown: isReversed ? handleResize : header.getResizeHandler(),
        onTouchStart: isReversed ? handleResize : header.getResizeHandler(),
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        className: cn(
          styles.resizeHandle,
          position === "left" && "right-auto left-0",
          header.column.getIsResizing() && styles.resizeHandleActive,
        ),
      }}
    />
  );
}

export type TableHeaderDragProps = {
  onDragStart: (e: React.DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}

const TableHeaderDrag = ({ onDragStart, onDragEnd }: TableHeaderDragProps) => {
  return (
    <button
      type="button"
      data-drag-zone
      draggable
      className={styles.dragZone}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <GripVertical className="w-4 h-4" />
    </button>
  );
}

export type TableHeaderPinProps<T> = {
  header: Header<T, unknown>,
  isPinned: ColumnPinningPosition,
  table: TanstackTable<T>
}

const TableHeaderPin = <TData, _>({
  header,
  isPinned,
  table
}: TableHeaderPinProps<TData>) => {

  const unpin = () => header.column.pin(false)
  const pinLeft = () => header.column.pin("left");
  const pinRight = () => header.column.pin("right");
  const hideColumn = () => header.column.toggleVisibility(false);

  return (
    isPinned ? (
      <Button
        size="small"
        variant="ghost"
        className="h-6 w-6 p-0 ml-1 opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-0"
        onClick={unpin}
        title="Unpin column"
      >
        <PinOff className="h-3 w-3" />
      </Button>
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="small"
            variant="ghost"
            className="h-6 w-6 p-0 ml-1 opacity-60 hover:opacity-100 focus-visible:outline-none focus-visible:ring-0"
            title="Pin column"
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={pinLeft}>
            <ArrowLeftToLine className="mr-2 h-4 w-4" />
            Stick to left
          </DropdownMenuItem>
          <DropdownMenuItem onClick={pinRight}>
            <ArrowRightToLine className="mr-2 h-4 w-4" />
            Stick to right
          </DropdownMenuItem>
          <DropdownMenuItem onClick={hideColumn}>
            <EyeOff className="mr-2 h-4 w-4" />
            Hide column
          </DropdownMenuItem>
          {table
            .getAllColumns()
            .filter((column) => column.getCanHide() && !column.getIsVisible())
            .length > 0 && (
              <>
                <div className="border-t my-1" />
                <div className="px-2 py-1.5 text-xs font-semibold text-gray-500">Show column:</div>
              </>
            )}
          {table
            .getAllColumns()
            .filter((column) => column.getCanHide() && !column.getIsVisible())
            .map((column) => {
              const columnHeader = column.columnDef.header;
              let columnName = column.id;

              if (typeof columnHeader === 'function') {
                const headerElement = columnHeader({} as any);
                if (headerElement?.props?.content) {
                  columnName = headerElement.props.content;
                }
              } else if (typeof columnHeader === 'string') {
                columnName = columnHeader;
              }

              return (
                <DropdownMenuItem
                  key={column.id}
                  onClick={() => column.toggleVisibility(true)}
                >
                  <EyeOff className="mr-2 h-4 w-4 opacity-50" />
                  {columnName}
                </DropdownMenuItem>
              );
            })}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  )
}

type TableHeadProps<T> = {
  header: Header<T, unknown>
  columnOrder: string[]
  enableColumnReordering: boolean
  draggedColumn: string | null
  dropTarget: string | null
  setDropTarget: (x: string | null) => void
  setDraggedColumn: (x: string | null) => void
  setColumnOrder: (order: ColumnOrderState) => void
  table: TanstackTable<T>
} & React.ComponentProps<"th">

const TableHead = <TData, _>({
  header,
  columnOrder,
  draggedColumn,
  dropTarget,
  enableColumnReordering,
  setDropTarget,
  setDraggedColumn,
  setColumnOrder,
  table,
  className,
  ...props
}: TableHeadProps<TData>) => {
  const columnKey = header.id;
  const isSortable = header.column.columnDef.enableSorting;
  const isPinned = header.column.getIsPinned();
  const isSorted = header.column.getIsSorted();
  const isDraggable = enableColumnReordering && !isPinned;
  const isDragging = draggedColumn === columnKey;
  const isDropTarget = dropTarget === columnKey;
  const isLastLeftPinned = isPinned === "left" && header.column.getIsLastColumn("left");
  const isFirstRightPinned = isPinned === "right" && header.column.getIsFirstColumn("right");

  const onClick = useCallback((e: React.MouseEvent<HTMLTableCellElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.closest("[data-resize-handle]") ||
      target.closest("[data-drag-zone]") ||
      target.closest("button") ||
      target.closest("[role='menu']")
    ) {
      return;
    }
    if (header.column.columnDef.enableSorting) {
      isSorted ?
        isSorted === 'desc' ? header.column.toggleSorting(false) : header.column.clearSorting()
        : header.column.toggleSorting(true);
    }
  }, [header.column, isSorted, isSortable]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLTableCellElement>) => {
    if (
      !isDraggable ||
      !draggedColumn ||
      draggedColumn === columnKey
    )
      return;
    e.preventDefault();
    setDropTarget(columnKey);
  }, [isDraggable, draggedColumn, columnKey, setDropTarget]);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLTableCellElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (
      x < rect.left ||
      x > rect.right ||
      y < rect.top ||
      y > rect.bottom
    ) {
      setDropTarget(null);
    }
  }, [setDropTarget]);

  const onDrop = useCallback((e: React.DragEvent<HTMLTableCellElement>) => {
    e.preventDefault();
    if (!isDraggable || !draggedColumn)
      return;

    const draggedIndex = columnOrder.indexOf(draggedColumn);
    const targetIndex = columnOrder.indexOf(columnKey);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      const newOrder = [...columnOrder];
      newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, draggedColumn);
      setColumnOrder(newOrder);
    }

    setDraggedColumn(null);
    setDropTarget(null);
  }, [isDraggable, draggedColumn, columnOrder, columnKey, setColumnOrder, setDraggedColumn, setDropTarget]);

  const onDragStart = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    setDraggedColumn(columnKey);
    e.dataTransfer.effectAllowed = "move";
  }, [columnKey, setDraggedColumn]);

  const onDragEnd = useCallback(() => {
    setDraggedColumn(null);
    setDropTarget(null);
  }, [setDraggedColumn, setDropTarget]);

  return (
    <th
      className={cn(
        styles.cellPadding,
        styles.th,
        styles.pinnedHeader,
        "relative",
        "group",
        isSortable && styles.thSortable,
        isSorted && styles.thSorted,
        header.column.columnDef.enableResizing && header.column.getCanResize() && styles.resizableHeader,
        // this style degradate perfomance!
        // isDraggable &&  styles.draggableHeader,
        isDragging && styles.draggingHeader,
        isDragging && styles.draggingColumn,
        isDropTarget && styles.dropZone,
        isDropTarget && styles.dropZoneActive,
        className,
      )}
      style={{
        ...getPinningStyles(header.column),
        width: `calc(var(--header-${header?.id}-size) * 1px)`,
      }}
      data-pinned={isPinned || undefined}
      data-last-col={isLastLeftPinned ? "left" : isFirstRightPinned ? "right" : undefined}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      {...props}
    >
      {isDraggable && <TableHeaderDrag onDragStart={onDragStart} onDragEnd={onDragEnd} />}
      {isPinned === "right" && <TableHeaderResize header={header} position="left" />}
      <div className={cn(styles.headerContent, "!justify-start")}>
        <div className={cn(
          "flex-1 min-w-0 overflow-hidden whitespace-nowrap",
          (isSorted || isPinned) ? "truncate pr-12" : "group-hover:truncate group-has-[[data-state=open]]:truncate group-hover:pr-12 group-has-[[data-state=open]]:pr-12"
        )}>
          {flexRender(header.column.columnDef.header, header.getContext())}
        </div>
        {(isSortable || header.column.columnDef.enablePinning) && (
          <div className="flex items-center gap-1 absolute right-0">
            {isSortable && (
              <div className={cn(
                "transition-opacity",
                isSorted ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-has-[[data-state=open]]:opacity-100"
              )}>
                <TableHeaderSort isSorted={isSorted} />
              </div>
            )}
            {header.column.columnDef.enablePinning && (
              <div className={cn(
                "transition-opacity",
                "opacity-0 group-hover:opacity-100 group-has-[[data-state=open]]:opacity-100"
              )}>
                <TableHeaderPin isPinned={isPinned} header={header} table={table} />
              </div>
            )}
          </div>
        )}
      </div>
      {isPinned !== "right" && <TableHeaderResize header={header} position="right" />}
    </th>
  )
};


type TableCellProps<TData, TValue> = {
  column: Column<TData, TValue>
  draggedColumn: string | null
  dropTarget: string | null
} & React.ComponentProps<"td">

const TableCell = <TData, TValue>({ column, draggedColumn, dropTarget, className, ...props }: TableCellProps<TData, TValue>) => {
  const columnKey = column.id;
  const isPinned = column.getIsPinned();
  const isSorted = column.columnDef.enableSorting && column.getIsSorted();
  const isBeingDragged = draggedColumn === columnKey;
  const isDropTarget = dropTarget === columnKey;
  const isLastLeftPinned = isPinned === "left" && column.getIsLastColumn("left");
  const isFirstRightPinned = isPinned === "right" && column.getIsFirstColumn("right");

  return (
    <td
      className={cn(
        styles.dataCell,
        styles.pinnedColumn,
        isSorted && styles.cellSorted,
        isBeingDragged && styles.draggingColumn,
        isDropTarget && styles.dropZone,
        isDropTarget && styles.dropZoneActive,
        className
      )}
      style={{
        ...getPinningStyles(column),
        width: `calc(var(--col-${column.id}-size) * 1px)`,
      }}
      data-pinned={isPinned || undefined}
      data-last-col={
        isLastLeftPinned
          ? "left"
          : isFirstRightPinned
            ? "right"
            : undefined
      }
      {...props}
    />
  )
};


export type TableHeaderContentProps = {
  content: React.ReactNode;
}

export function TableHeaderContent({
  content
}: TableHeaderContentProps) {
  return (
    <span className={styles.headerText}>{content}</span>
  )
}

export type TableCellContentProps = {
  content: React.ReactNode;
}

export function TableCellContent({ content }: TableCellContentProps) {
  return (
    <div
      className={cn("text-sm font-normal leading-[24px] truncate w-full")}
      title={typeof content === 'string' ? content : undefined}
    >
      {content}
    </div>
  );
}

export type TableDoubleCellContentProps = {
  content1: string | React.ReactNode,
  content2: string | React.ReactNode
}

export function TableDoubleCellContent({ content1, content2 }: TableDoubleCellContentProps) {
  return (
    <div className={cn("text-sm font-normal truncate w-full leading-[24px]")}>
      <div className="truncate w-full">
        {content1}
      </div>
      <div className="truncate w-full">
        {content2}
      </div>
    </div>
  )
}

type BaseFilterConfig = {
  columnId: string
  enabled: boolean
}

export type TextFilterConfig = BaseFilterConfig & {
  type: 'text'
  placeholder?: string
  value?: string
}

export type DateFilterConfig = BaseFilterConfig & {
  type: 'date'
  placeholder?: string
  value?: Date
}

export type DateRangeFilterConfig = BaseFilterConfig & {
  type: 'date-range'
  fromPlaceholder?: string
  toPlaceholder?: string
  value?: {
    from: string,
    to: string
  }
}

export type NumberFilterConfig = BaseFilterConfig & {
  type: 'number'
  value?: string
  placeholder?: string
  min?: number
  max?: number
  step?: number
}

export type EnumFilterConfig = BaseFilterConfig & {
  type: 'enum'
  options: { label: string; value: string }[] | string[]
  placeholder?: string
  value?: string
}

export type FilterConfig = TextFilterConfig | DateFilterConfig | DateRangeFilterConfig | NumberFilterConfig | EnumFilterConfig

export const isTextFilter = (filter: FilterConfig): filter is TextFilterConfig => {
  return filter.type === 'text';
};

export const isDateFilter = (filter: FilterConfig): filter is DateFilterConfig => {
  return filter.type === 'date';
};

export const isDateRangeFilter = (filter: FilterConfig): filter is DateRangeFilterConfig => {
  return filter.type === 'date-range';
};

export const isNumberFilter = (filter: FilterConfig): filter is NumberFilterConfig => {
  return filter.type === 'number';
};

export const isEnumFilter = (filter: FilterConfig): filter is EnumFilterConfig => {
  return filter.type === 'enum';
};

type BaseFilterProps = {
  columnId: string;
  onValueChange: (value: any) => void;
  submitFilter?: () => void;
}

type TextFilterProps = {
  filter: TextFilterConfig;
} & BaseFilterProps;

type DateFilterProps = {
  filter: DateFilterConfig
} & BaseFilterProps

type DateRangeFilterProps = {
  filter: DateRangeFilterConfig
} & BaseFilterProps;

type NumberFilterProps = {
  filter: NumberFilterConfig
} & BaseFilterProps;

type EnumFilterProps = {
  filter: EnumFilterConfig
} & BaseFilterProps

const filterInputClasses = "text-sm border-0 bg-transparent focus-visible:ring-0 placeholder:text-[#CCCED3] focus:outline-none";

export const TextFilter: React.FC<TextFilterProps> = ({ filter, columnId, onValueChange, submitFilter }) => {
  const [localValue, setLocalValue] = useState(filter.value ?? "");

  // Sync with external filter value changes
  useEffect(() => {
    setLocalValue(filter.value ?? "");
  }, [filter.value]);

  return (
    <Input
      leftSlot={<SearchIcon />}
      key={columnId}
      type="text"
      placeholder={filter.placeholder || columnId}
      value={localValue}
      onKeyDown={(e) => {
        if (e.key === "Enter" && submitFilter)
          submitFilter()
      }}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value
        setLocalValue(newValue)
        onValueChange(newValue)
      }
      }
      className={filterInputClasses}
    />
  );
};

export const DateFilter: React.FC<DateFilterProps> = ({ filter, columnId, onValueChange, submitFilter }) => {
  // Initialize with formatted date from props, or empty string
  const [localValue, setLocalValue] = useState<string>(() => {
    if (!filter.value) return "";
    if (typeof filter.value === 'string') {
      try {
        return format(new Date(filter.value), "MM/dd/yyyy");
      } catch {
        return "";
      }
    }
    return format(filter.value, "MM/dd/yyyy");
  });

  // Sync with external filter value changes
  useEffect(() => {
    if (!filter.value) {
      setLocalValue("");
      return;
    }
    if (typeof filter.value === 'string') {
      try {
        setLocalValue(format(new Date(filter.value), "MM/dd/yyyy"));
      } catch {
        setLocalValue("");
      }
    } else {
      setLocalValue(format(filter.value, "MM/dd/yyyy"));
    }
  }, [filter.value]);

  const handleDateInputChange = (value: string) => {
    if (!value) {
      setLocalValue("");
      onValueChange(undefined);
      return;
    }

    // Try to parse MM/dd/yyyy format
    let parsed = parse(value, "MM/dd/yyyy", new Date());
    if (isValid(parsed)) {
      setLocalValue(value);
      onValueChange(format(parsed, "yyyy-MM-dd"));
      return;
    }

    // Try to parse yyyy-MM-dd format (ISO)
    parsed = parse(value, "yyyy-MM-dd", new Date());
    if (isValid(parsed)) {
      const formatted = format(parsed, "MM/dd/yyyy");
      setLocalValue(formatted);
      onValueChange(format(parsed, "yyyy-MM-dd"));
      return;
    }

    // If neither format is valid, just store the raw input
    setLocalValue(value);
  };

  // Convert display value to Date for DatePicker
  const datePickerValue = localValue
    ? (() => {
      try {
        const parsed = parse(localValue, "MM/dd/yyyy", new Date());
        return isValid(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    })()
    : undefined;

  return (
    <Input
      leftSlot={
        <DatePicker
          key={columnId}
          onDateChange={(dateString) => {
            if (dateString) {
              const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
              setLocalValue(format(date, "MM/dd/yyyy"));
              onValueChange(typeof dateString === 'string' ? dateString : format(dateString, "yyyy-MM-dd"));
            } else {
              setLocalValue("");
              onValueChange(undefined);
            }
          }}
          value={datePickerValue}
          onlyIcon={true}
        />
      }
      type="text"
      placeholder={filter.placeholder || "MM/dd/yyyy"}
      key={columnId}
      value={localValue}
      onKeyDown={(e) => {
        if (e.key === "Enter" && submitFilter)
          submitFilter()
      }}
      onChange={(e) => handleDateInputChange(e.target.value)}
      className={filterInputClasses}
    />
  );
};

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ filter, columnId, onValueChange }) => {
  // Convert string dates to Date objects for the component
  const dateValue = filter.value ? {
    from: filter.value.from ? new Date(filter.value.from) : undefined,
    to: filter.value.to ? new Date(filter.value.to) : undefined
  } : undefined;

  return (
    <DateRangePicker
      key={columnId}
      value={dateValue}
      onDateRangeChange={onValueChange}
      fromPlaceholder={filter.fromPlaceholder}
      toPlaceholder={filter.toPlaceholder}
    />
  );
};

export const NumberFilter: React.FC<NumberFilterProps> = ({ filter, columnId, onValueChange, submitFilter }) => {
  const [localValue, setLocalValue] = useState(filter.value ?? "");

  // Sync with external filter value changes
  useEffect(() => {
    setLocalValue(filter.value ?? "");
  }, [filter.value]);

  return (
    <Input
      key={columnId}
      type="text"
      placeholder={filter.placeholder || columnId}
      value={localValue}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value
        setLocalValue(newValue)
        onValueChange(newValue)
      }
      }
      onKeyDown={(e) => {
        if (e.key === "Enter" && submitFilter)
          submitFilter()
      }}
      className="h-full text-sm border-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent placeholder:text-[#CCCED3] px-0"
      min={filter.min}
      max={filter.max}
      step={filter.step}
    />
  );
};

export const EnumFilter: React.FC<EnumFilterProps> = ({ filter, columnId, onValueChange, submitFilter }) => {
  const CLEAR_VALUE = "__CLEAR__";

  const selectValue = filter.value === undefined || filter.value === null || filter.value === ""
    ? undefined
    : filter.value;

  const handleValueChange = (value: string) => {
    if (value === CLEAR_VALUE) {
      onValueChange(undefined);
    } else {
      onValueChange(value);
      submitFilter && submitFilter()
    }
  };

  return (
    <Select
      key={`${columnId}-${selectValue || 'empty'}`}
      value={selectValue}
      onValueChange={handleValueChange}
    >
      <SelectTrigger size="small" className="w-full">
        <SelectValue placeholder={filter.placeholder || columnId} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={CLEAR_VALUE}>
          <span className="text-gray-500 italic">Clear selection</span>
        </SelectItem>
        {filter.options.map((opt) => {
          const val = typeof opt === 'string' ? opt : opt.value;
          const label = typeof opt === 'string' ? opt : opt.label;
          return (
            <SelectItem key={val} value={val}>
              {label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

type FilterCellProps<TData, TValue> = {
  filter: FilterConfig;
  header: Header<TData, TValue>;
  submitFilter?: () => void;
}

function FilterCell<TData, TValue>({ filter, header, submitFilter }: FilterCellProps<TData, TValue>) {
  const handleValueChange = useCallback((value: any) => {
    header.column.setFilterValue(value);
  }, [header.column]);

  switch (filter.type) {
    case 'enum':
      return <EnumFilter filter={filter} columnId={filter.columnId} onValueChange={handleValueChange} submitFilter={submitFilter} />
    case 'date-range':
      return <DateRangeFilter filter={filter} columnId={filter.columnId} onValueChange={handleValueChange} submitFilter={submitFilter} />
    case 'number':
      return <NumberFilter filter={filter} columnId={filter.columnId} onValueChange={handleValueChange} submitFilter={submitFilter} />
    case 'date':
      return <DateFilter filter={filter} columnId={filter.columnId} onValueChange={handleValueChange} submitFilter={submitFilter} />
    case 'text':
    default:
      return <TextFilter filter={filter} columnId={filter.columnId} onValueChange={handleValueChange} submitFilter={submitFilter} />
  }
}

type FilterRowProps<TData, TValue> = {
  headers: Header<TData, TValue>[];
  draggedColumn: string | null;
  dropTarget: string | null;
  filterConfigMap: Map<string, FilterConfig>;
  submitFilter?: () => void;
}

function FilterRow<TData, TValue>({
  headers,
  draggedColumn,
  dropTarget,
  filterConfigMap: searchConfigMap,
  submitFilter
}: FilterRowProps<TData, TValue>) {
  return (
    <tr className={styles.filterRow}>
      {headers.map((header) => {

        const filterConfig = searchConfigMap.get(header.column.id);

        return (
          <TableCell
            key={`filter-${header.id}`}
            column={header.column}
            draggedColumn={draggedColumn}
            dropTarget={dropTarget}
          >
            {filterConfig ? <FilterCell submitFilter={submitFilter} filter={filterConfig} header={header} /> : <div className={styles.filterActions}></div>}
          </TableCell>
        );
      })}
    </tr>
  );
}

export type ColumnFilterConfig = FilterConfig[]

export type PinnedRows = {
  rowIds: string[]
  gap?: React.ReactNode
}

export type UiState = {
  columnOrder: ColumnOrderState,
  columnSizing: ColumnSizingState,
  columnPinning: ColumnPinningState,
  columnVisibility: VisibilityState,
  pagination?: {
    pageIndex: number,
    pageSize: number
  },
  drawerWidth?: number
}

type DataTableProps<T> = {
  columns: ColumnDef<T>[];
  data: T[];
  pageIndex: number;
  pageSize: number;
  pageCount?: number;
  filterConfig?: ColumnFilterConfig;
  sortingConfig?: SortingState;
  showZebraStripes?: boolean;
  showFilters?: boolean;
  enableColumnReordering?: boolean;
  onSort?: (sorting: SortingState) => void;
  onFilter?: (filters: ColumnFiltersState) => void;
  onPaginationChange?: (pagination: PaginationState) => void
  onRowClick?: (row: T) => void;
  onCellClick?: (data: T, columnId: string) => void;
  onUiChange?: (uiState: UiState) => void;
  initialUiState?: UiState;
  pinnedRows?: PinnedRows
  getRowId?: (x: T) => string
  isLoading?: boolean
  searchButton?: (filters: ColumnFiltersState) => ReactNode

  paginationComponent?: React.ComponentType<{
    canPrevious: boolean
    canNext: boolean
    currentPage: number
    pageSize: number
    onChangePage: (i: number) => void
    onPageSizeChange: (v: number) => void
    pageCount?: number
    disabled?: boolean
  }>

  blurStartLine?: number
  paginationDisable?:boolean
  expandedRows?:boolean
  ExpandedRowContent?: React.FC<{ row: T }>
}

export const MemoizedTableBody = React.memo(
  TableBody,
  (prev, next) => prev.table.options.data === next.table.options.data
) as typeof TableBody

export function DataTable<T>({
  columns,
  data,
  pinnedRows,
  pageIndex,
  pageSize,
  pageCount,
  filterConfig,
  sortingConfig,
  showZebraStripes = false,
  showFilters = true,
  enableColumnReordering = false,
  onSort,
  onFilter,
  onPaginationChange,
  onRowClick,
  onCellClick,
  getRowId,
  onUiChange,
  initialUiState,
  paginationComponent: PaginationComponent,
  isLoading = false,
  searchButton,
  blurStartLine,
  paginationDisable,
  expandedRows,
  ExpandedRowContent
}: DataTableProps<T>) {

  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const filterConfigMap = useMemo(() => {
    const map = new Map<string, FilterConfig>();
    filterConfig?.forEach(filter => {
      map.set(filter.columnId, filter);
    });
    return map;
  }, [filterConfig]);

  // Compute columnFilters from props (filterConfig)
  const columnFilters = useMemo(() => {
    return filterConfig?.reduce<{ id: string, value: unknown }[]>((acc, filter) => {
      if (filter.value !== undefined && filter.value !== null) {
        acc.push({ id: filter.columnId, value: filter.value })
      }
      return acc
    }, []) || []
  }, [filterConfig]);

  const pagination = { pageIndex, pageSize }
  const [sorting, setSorting] = useState<SortingState>(sortingConfig || []);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(initialUiState?.columnOrder || []);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(initialUiState?.columnSizing || {})
  const [columnPinning, setColumnPinning] = React.useState<ColumnPinningState>(initialUiState?.columnPinning || { left: [], right: [] });
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(initialUiState?.columnVisibility || {});
  const [rowPinning, setRowPinning] = React.useState<RowPinningState>({
    top: pinnedRows?.rowIds || [],
    bottom: [],
  });

  const [newColumnFilters, setNewColumnFilters] = React.useState<ColumnFiltersState>(() => columnFilters)
  const newColumnFiltersRef = useRef<ColumnFiltersState>(columnFilters)

  // Track if the component has been initialized to avoid calling onUiChange on mount
  const isInitialized = useRef(false);

  useEffect(() => {
    setNewColumnFilters(columnFilters);
    newColumnFiltersRef.current = columnFilters;
  }, [columnFilters]);

  const table = useReactTable({
    data,
    columns: columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualFiltering: true,
    manualSorting: true,
    columnResizeMode: "onChange",
    getExpandedRowModel: getExpandedRowModel(),
    state: {
      columnOrder,
      columnFilters,
      columnSizing,
      pagination,
      sorting,
      columnPinning,
      columnVisibility,
      rowPinning
    },
    getRowId,
    onRowPinningChange: setRowPinning,
    onColumnSizingChange: setColumnSizing,
    onColumnPinningChange: setColumnPinning,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onPaginationChange: (updater) => {
      const newPagination = typeof updater === "function" ? updater(pagination) : updater;
      onPaginationChange && onPaginationChange({
        pageIndex: newPagination.pageIndex + 1,
        pageSize: newPagination.pageSize,
      });
    },
    onColumnFiltersChange: (updater) => {
      setNewColumnFilters(prev => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        newColumnFiltersRef.current = next;
        return next;
      })
    },
    onSortingChange: (updater) => {
      const newSort = typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSort);
      onSort && onSort(newSort);
    }
  });

  useEffect(() => {
    // Skip the first render to avoid overwriting loaded state
    if (!isInitialized.current) {
      isInitialized.current = true;
      return;
    }

    // Only call onUiChange after initialization for actual user changes
    onUiChange && onUiChange({
      columnOrder,
      columnSizing,
      columnPinning,
      columnVisibility,
      pagination: {
        pageIndex,
        pageSize
      }
    });
  }, [columnOrder, columnSizing, columnPinning, columnVisibility, pageIndex, pageSize]);

  const handleRowClick = (row: T): MouseEventHandler<HTMLTableRowElement> =>
    (_) => onRowClick && onRowClick(row);

  /**
   * Instead of calling `column.getSize()` on every render for every header
   * and especially every data cell (very expensive),
   * we will calculate all column sizes at once at the root table level in a useMemo
   * and pass the column sizes down as CSS variables to the <table> element.
   */
  const columnSizeVars = useMemo(() => {
    const headers = table.getFlatHeaders()
    const colSizes: { [key: string]: number } = {}
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i]!
      colSizes[`--header-${header.id}-size`] = header.getSize()
      colSizes[`--col-${header.column.id}-size`] = header.column.getSize()
    }
    return colSizes
  }, [table.getState().columnSizingInfo, table.getState().columnSizing]);

  return (
    <div>
      <div className={`${styles.tableContainer} relative`}>
        <Table className={styles.table} style={{ ...columnSizeVars }} >
          <TableHeader className={styles.thead}>
            <tr>
              {table.getHeaderGroups()[0]?.headers.map((header) =>
                <TableHead
                  key={`header-${header.id}`}
                  header={header}
                  columnOrder={table.getAllLeafColumns().map((col) => col.id)}
                  enableColumnReordering={enableColumnReordering}
                  draggedColumn={draggedColumn}
                  dropTarget={dropTarget}
                  setDraggedColumn={setDraggedColumn}
                  setDropTarget={setDropTarget}
                  setColumnOrder={setColumnOrder}
                  table={table}
                />)}
            </tr>
          </TableHeader>
          <TableBody
            table={table}
            pinnedRows={pinnedRows}
            showFilters={showFilters}
            draggedColumn={draggedColumn}
            dropTarget={dropTarget}
            filterConfigMap={filterConfigMap}
            handleRowClick={handleRowClick}
            onCellClick={onCellClick}
            showZebraStripes={showZebraStripes}
            isLoading={isLoading}
            onFilter={onFilter && (() => onFilter(newColumnFiltersRef.current))}
            blurStartLine={blurStartLine}
            expandedRows={expandedRows}
            ExpandedRowContent={ExpandedRowContent}
          />
        </Table>
      </div>
      <div className="flex items-end gap-4 mt-4">
        {PaginationComponent &&
          <PaginationComponent
            pageCount={pageCount}
            currentPage={pageIndex}
            canPrevious={table.getCanPreviousPage()}
            canNext={pageCount === undefined ? data.length >= pageSize : table.getCanNextPage()}
            onChangePage={x => table.setPageIndex(x - 1)}
            onPageSizeChange={table.setPageSize}
            pageSize={pageSize}
            disabled={paginationDisable}
          />}
        {searchButton && searchButton(newColumnFilters)}
      </div>
    </div>

  );
}
