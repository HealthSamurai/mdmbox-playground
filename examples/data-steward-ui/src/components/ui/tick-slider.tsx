
import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

type TickSliderProps = {
    defaultValue?: number[];
    value?: number[];
    onValueChange?: (value: number[]) => void;
    max?: number;
    min?: number;
    step?: number;
}

export default function TickSlider({
                                       defaultValue = [5],
                                       value,
                                       onValueChange,
                                       max = 12,
                                       min = 0,
                                       step = 1
                                   }: TickSliderProps) {
    const [internalValue, setInternalValue] = React.useState(value || defaultValue);
    const hasZeroInRange = min < 0 && max > 0;
    const zeroPosition = hasZeroInRange ? Math.abs(min) / (max - min) * 100 : 0;

    React.useEffect(() => {
        if (value !== undefined) {
            setInternalValue(value);
        }
    }, [value]);

    const handleSliderChange = (newValue: number[]) => {
        setInternalValue(newValue);
        onValueChange?.(newValue);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const inputValue = parseFloat(e.target.value);
        if (!isNaN(inputValue)) {
            const clampedValue = Math.max(min, Math.min(max, inputValue));
            const newValue = [clampedValue];
            setInternalValue(newValue);
            onValueChange?.(newValue);
        }
    };

    return (
        <div className="flex items-center gap-4 w-full">
            <input
                type="number"
                value={internalValue[0]}
                onChange={handleInputChange}
                min={min}
                max={max}
                step={step}
                className="w-20 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">{min}</span>
            <div className="flex-1 relative">
                <SliderPrimitive.Root
                    value={internalValue}
                    onValueChange={handleSliderChange}
                    max={max}
                    min={min}
                    step={step}
                    className="relative flex w-full touch-none select-none items-center"
                >
                    <SliderPrimitive.Track className="relative h-0.5 w-full grow overflow-hidden rounded-full bg-gray-200">
                        <SliderPrimitive.Range className="absolute h-full bg-blue-500"/>
                    </SliderPrimitive.Track>
                    {hasZeroInRange && (
                        <div
                            className="absolute w-0.5 h-3 bg-muted-foreground/50"
                            style={{ left: `${zeroPosition}%`, top: '50%', transform: 'translateY(-50%)' }}
                        />
                    )}
                    <SliderPrimitive.Thumb
                        className="block h-4 w-4 rounded-full bg-blue-500 ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"/>
                </SliderPrimitive.Root>
            </div>
            <span className="text-xs text-muted-foreground">{max}</span>
        </div>
    );
}