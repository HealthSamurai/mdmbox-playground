import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@health-samurai/react-components";

export type MatchDetails = {
  fn: number;
  dob: number;
  ext: number;
  sex: number;
};
import { ReactNode } from "react";

const detailRows = [
  { key: 'fn', label: 'Name', color: 'text-indigo-500' },
  { key: 'dob', label: 'DOB', color: 'text-purple-500' },
  { key: 'ext', label: 'Address', color: 'text-rose-500' },
  { key: 'sex', label: 'Sex', color: 'text-green-500' },
];

type MatchTooltipProps = {
  details: MatchDetails;
  children: ReactNode;
  model: string
}

export default function MatchTooltip({ details, children, model }: MatchTooltipProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button className="cursor-default" variant="secondary">
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent className="border bg-white py-2" side="bottom" sideOffset={5} style={{ width: 'var(--radix-popper-anchor-width)' }}>
          {detailRows.map(row => (
            <div key={row.key} className="flex items-center gap-2 text-xs">
              <svg
                width="8"
                height="8"
                fill="currentColor"
                viewBox="0 0 8 8"
                xmlns="http://www.w3.org/2000/svg"
                className={`shrink-0 ${row.color}`}
                aria-hidden="true"
              >
                <circle cx="4" cy="4" r="4"></circle>
              </svg>
              <span className="text-black flex grow gap-2">
                {row.label} <span className="ml-auto">{details[row.key as keyof MatchDetails]?.toFixed(4)}</span>
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 text-xs mt-2 pt-2 border-t">
            <span className="text-gray-600">Model:</span>
            <span className="text-black ml-auto">{model}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
