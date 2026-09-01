
import React, { useEffect, useState, useRef } from "react";
import { Input } from "@health-samurai/react-components";

type DebouncedInputProps = {
  value: string;
  onChange: (value: string) => void;
  debounceMs?: number;
  [x: string]: any; // for other props like type, placeholder, className
};

function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debounced = function (this: any, ...args: Parameters<T>) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, wait);
  } as T & { cancel: () => void };

  debounced.cancel = function () {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return debounced;
}

export function DebouncedInput({
  value,
  onChange,
  debounceMs = 500,
  ...props
}: DebouncedInputProps) {
  const [localValue, setLocalValue] = useState(value ?? "");
  const lastChangeTimeRef = useRef<number>(0);
  const debouncedChangeRef = useRef(
    debounce((val: string) => {
      onChange(val);
    }, debounceMs)
  );

  // Update debounced function when debounceMs or onChange changes
  useEffect(() => {
    debouncedChangeRef.current.cancel();
    debouncedChangeRef.current = debounce((val: string) => {
      onChange(val);
    }, debounceMs);

    return () => {
      debouncedChangeRef.current.cancel();
    };
  }, [onChange, debounceMs]);

  // Sync local value with external value
  // BUT ignore updates if user is still typing (within debounce window + buffer)
  useEffect(() => {
    const timeSinceLastChange = Date.now() - lastChangeTimeRef.current;
    const isStillTyping = timeSinceLastChange < debounceMs + 200;

    if (!isStillTyping) {
      setLocalValue(value ?? "");
    }
  }, [value, debounceMs]);

  // Handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    lastChangeTimeRef.current = Date.now();
    setLocalValue(newValue);

    // Cancel previous debounced call and schedule new one
    debouncedChangeRef.current.cancel();
    debouncedChangeRef.current(newValue);
  };

  return (
    <Input
      {...props}
      value={localValue}
      onChange={handleChange}
    />
  );
}
