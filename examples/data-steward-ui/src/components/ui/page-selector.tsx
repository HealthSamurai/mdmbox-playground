import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@health-samurai/react-components";

export type PageSelectorProps = {
    pageSizeOptions?: string[]
    onPageSizeChange?: (v: number) => void
    pageSize: number
}

export function PageSelector(props:PageSelectorProps){
    const pageSizeOpt: string[] = props.pageSizeOptions || ['10', '20', '50', '100'];

    return(
        <Select
            value={String(props.pageSize)}
            aria-label="Results per page"
            onValueChange={(val) => props.onPageSizeChange && props.onPageSizeChange(parseInt(val, 10))}
        >
            <SelectTrigger id="results-per-page" className="w-fit whitespace-nowrap">
                <SelectValue placeholder="Select number of results" />
            </SelectTrigger>
            <SelectContent>
                {pageSizeOpt.map(opt => (
                    <SelectItem key={opt} value={String(opt)}>{opt} / page</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}