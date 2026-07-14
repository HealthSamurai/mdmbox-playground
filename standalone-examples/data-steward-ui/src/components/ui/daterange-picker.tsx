
import { useId } from "react"
import { format } from "date-fns"
import { CalendarIcon } from "./icons"
import { DateRange } from "react-day-picker"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Calendar
} from "@health-samurai/react-components"
import { cn } from "./utils"

type DateRangePickerProps = {
  value?: { from?: Date; to?: Date }
  onDateRangeChange: (value?: { from?: string; to?: string }) => void
  fromPlaceholder?: string
  toPlaceholder?: string
}

export function DateRangePicker(props: DateRangePickerProps) {
  const id = useId()

  // Use a consistent date format to avoid hydration issues
  const formatDate = (date: Date) => {
    return format(date, "MM/dd/yyyy")
  }

  const handleSelect = (range: DateRange | undefined) => {
    if (!range) {
      props.onDateRangeChange(undefined)
    } else {
      props.onDateRangeChange({
        from: range.from ? format(range.from, "yyyy-MM-dd") : undefined,
        to: range.to ? format(range.to, "yyyy-MM-dd") : undefined
      })
    }
  }

  // Convert to DateRange type for Calendar
  const selectedRange: DateRange | undefined = props.value?.from
    ? { from: props.value.from, to: props.value.to }
    : undefined

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="ghost"
          className="group bg-background hover:bg-background w-full justify-start font-normal"
        >
          <CalendarIcon />
          <span
            className={cn("truncate", !props.value?.from && "text-[#CCCED3]")}
          >
            {props.value?.from ? (
              props.value.to ? (
                <>
                  {formatDate(props.value.from)} - {formatDate(props.value.to)}
                </>
              ) : (
                formatDate(props.value.from)
              )
            ) : (
              "Pick a date range"
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <Calendar
          mode="range"
          selected={selectedRange}
          onSelect={handleSelect}
        />
      </PopoverContent>
    </Popover>
  )
}
