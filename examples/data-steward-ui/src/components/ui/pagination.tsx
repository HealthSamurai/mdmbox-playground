
import {
  Pagination as AidoboxPagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious
} from "@health-samurai/react-components";
import { PageSelector } from "./page-selector";
import { usePagination } from "./hooks";

type PaginationProps = {
  canPrevious: boolean
  canNext: boolean
  currentPage: number
  pageSize: number
  onChangePage: (i: number) => void
  onPageSizeChange: (v:number) => void
  pageCount: number
  paginationItemsToDisplay?: number
}

export function MdmPagination({
  currentPage,
  pageCount,
  paginationItemsToDisplay = 5,
  pageSize,
  onPageSizeChange,
  onChangePage,
  canPrevious,
  canNext
}: PaginationProps) {
  const { pages, showLeftEllipsis, showRightEllipsis } = usePagination({
    currentPage,
    totalPages: pageCount,
    paginationItemsToDisplay,
  })

  return (
    <div className="mt-4 flex justify-end w-full">
      <AidoboxPagination className="mx-4 w-auto">
        <PaginationContent>
          {/* Previous page button */}
          <PaginationItem>
            <PaginationPrevious
              size="regular"
              className="aria-disabled:pointer-events-none aria-disabled:opacity-50 cursor-pointer"
              aria-disabled={!canPrevious}
              onClick={(e) => {
                if (!canPrevious) return;
                e.preventDefault();
                const searchParams = new URLSearchParams(window.location.search);
                const page = parseInt(searchParams.get('page') || '1')
                onChangePage(page - 1);
              }}
            />
          </PaginationItem>

          {/* Left ellipsis (...) */}
          {showLeftEllipsis && (
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          )}

          {/* Page number links */}
          {pages.map((page) => (
            <PaginationItem key={page}>
              <PaginationLink
                size="regular"
                className="cursor-pointer"
                isActive={page === currentPage}
                onClick={(e) => {
                  e.preventDefault();
                  onChangePage(page);
              }}
              >
                {page}
              </PaginationLink>
            </PaginationItem>
          ))}

          {/* Right ellipsis (...) */}
          {showRightEllipsis && (
            <PaginationItem>
              <PaginationEllipsis />
            </PaginationItem>
          )}

          {/* Next page button */}
          <PaginationItem>
            <PaginationNext
              size="regular"
              className="aria-disabled:pointer-events-none aria-disabled:opacity-50 cursor-pointer"
              aria-disabled={!canNext}
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
      </AidoboxPagination>
      <PageSelector
        onPageSizeChange={onPageSizeChange}
        pageSize={pageSize}
      />
    </div>
  )
}


