
import { useId } from "react"
import { format } from "date-fns"
import { CalendarIcon } from "./icons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Calendar,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from "@health-samurai/react-components"

type DatePickerProps = {
  value?: Date
  onDateChange: (value?: string) => void
  onlyIcon?: boolean
}

export function DatePicker(props: DatePickerProps) {
  const id = useId()

  // Use a consistent date format to avoid hydration issues
  // Using ISO date format (yyyy-MM-dd) for consistent rendering
  const formatDate = (date: Date) => {
    return format(date, "MM/dd/yyyy")
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {!props.onlyIcon ? <Button
          id={id}
          variant={"ghost"}
          className="group bg-background hover:bg-background w-full justify-start font-normal"
        >
          <CalendarIcon />
          {props.value ?
            <span className={"truncate"}> {formatDate(props.value)} </span> :
            <span className="truncate text-[#CCCED3]"> Date </span>}
        </Button> : <Button
          id={id}
          variant={"ghost"}
          size="small"
          className="p-0 h-auto hover:bg-transparent"
        >
          <CalendarIcon />
        </Button>}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <Calendar
          mode="single"
          selected={props.value}
          onSelect={(value) => props.onDateChange(value ? format(value, "yyyy-MM-dd") : undefined)}
          captionLayout="dropdown"
          components={{
            Dropdown: ({ className, ...props }) => {
              return (
                <Select
                  defaultValue={props.value?.toString()}
                  onValueChange={(val) => props.onChange?.({ target: { value: val } } as any)}
                >
                  <SelectTrigger className="z-[9999] w-full" size={"regular"}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-auto" side="bottom" sideOffset={4}>
                    {props.options?.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value.toString()}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
