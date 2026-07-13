import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@health-samurai/react-components";
import { PageSelector } from "./page-selector";
import { cn } from "./utils";

type SimplePaginationProps = {
    canPrevious: boolean
    canNext: boolean
    currentPage: number
    pageSize: number
    onChangePage: (i: number) => void
    onPageSizeChange: (v:number) => void
    pageCount?: number
    previousLabel?: string
    nextLabel?: string
    disabled?: boolean
}

export function SimplePagination({
  canPrevious,
  canNext,
  onChangePage,
  pageSize,
  onPageSizeChange,
  disabled
}: SimplePaginationProps) {
  return (
    <div className={cn(
        "mt-4 flex justify-end w-full",
        disabled && "pointer-events-none opacity-50"
    )}>
        <Pagination className="mx-4 w-auto">
            <PaginationContent>
                <PaginationItem>
                    <PaginationPrevious
                        size={"regular"}
                        className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                        href={canPrevious ? "#prev" : undefined}
                        aria-disabled={canPrevious ? undefined : true}
                        role={canPrevious ? undefined : "link"}
                        onClick={(e) => {
                            if (!canPrevious) return;
                            e.preventDefault();
                            const searchParams = new URLSearchParams(window.location.search);
                            const page = parseInt(searchParams.get('page') || '1')
                            onChangePage(page - 1);
                        }}
                    />
                </PaginationItem>
                <PaginationItem>
                    <PaginationNext
                        size={"regular"}
                        className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                        href={canNext ? "#next" : undefined}
                        aria-disabled={canNext ? undefined : true}
                        role={canNext ? undefined : "link"}
                        onClick={(e) => {
                            if (!canNext) return;
                            e.preventDefault();
                            const searchParams = new URLSearchParams(window.location.search);
                            const page = parseInt(searchParams.get('page') || '1');
                            onChangePage(page + 1);
                        }}
                    />
                </PaginationItem>
            </PaginationContent>
        </Pagination>
        <PageSelector
            onPageSizeChange={onPageSizeChange}
            pageSize={pageSize}
        />
    </div>
  )
}


