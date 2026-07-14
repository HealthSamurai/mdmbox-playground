import { useState, useEffect, useCallback, useRef } from "react";
import { UiState } from "./data-table";

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}

export type UsePaginationParams = {
  currentPage: number
  totalPages: number
  paginationItemsToDisplay?: number
}

export type UsePaginationResult = {
  pages: number[]
  showLeftEllipsis: boolean
  showRightEllipsis: boolean
}

export function usePagination({
  currentPage,
  totalPages,
  paginationItemsToDisplay = 5,
}: UsePaginationParams): UsePaginationResult {
  const display = Math.max(1, Math.floor(paginationItemsToDisplay))
  const total = Math.max(1, Math.floor(totalPages))
  const current = Math.min(Math.max(1, Math.floor(currentPage)), total)

  const showLeftEllipsis = current - 1 > display / 2
  const showRightEllipsis = total - current + 1 > display / 2

  function calculatePaginationRange(): number[] {
    if (total <= display) {
      return Array.from({ length: total }, (_, i) => i + 1)
    }

    const halfDisplay = Math.floor(display / 2)
    const initialRange = {
      start: current - halfDisplay,
      end: current + halfDisplay,
    }

    const adjustedRange = {
      start: Math.max(1, initialRange.start),
      end: Math.min(total, initialRange.end),
    }

    if (adjustedRange.start === 1) {
      adjustedRange.end = display
    }
    if (adjustedRange.end === total) {
      adjustedRange.start = total - display + 1
    }

    if (showLeftEllipsis) adjustedRange.start++
    if (showRightEllipsis) adjustedRange.end--

    return Array.from(
      { length: adjustedRange.end - adjustedRange.start + 1 },
      (_, i) => adjustedRange.start + i
    )
  }

  const pages = calculatePaginationRange()

  return {
    pages,
    showLeftEllipsis,
    showRightEllipsis,
  }
}

export function useAutoLogout(timeoutMinutes = 15, onLogout: () => void) {
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(60);

  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownInterval = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showWarningRef = useRef(false);

  const startTimers = () => {
    clearTimers();

    warningTimer.current = setTimeout(() => {
      setShowWarning(true);
      showWarningRef.current = true;
      setSecondsRemaining(60);

      countdownInterval.current = setInterval(() => {
        setSecondsRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval.current!);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, (timeoutMinutes - 1) * 60 * 1000);

    logoutTimer.current = setTimeout(() => {
      onLogout();
    }, timeoutMinutes * 60 * 1000);
  };

  const clearTimers = () => {
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
    if (warningTimer.current) clearTimeout(warningTimer.current);
    if (countdownInterval.current) clearInterval(countdownInterval.current);
  };

  const resetTimers = () => {
    if (!showWarningRef.current) {
      clearTimers();
      startTimers();
    }
  };

  const handleStay = () => {
    setShowWarning(false);
    showWarningRef.current = false;
    clearTimers();
    startTimers();
  };

  useEffect(() => {
    const events = ["mousemove", "mousedown", "keypress", "scroll", "touchstart"];

    events.forEach((event) => {
      window.addEventListener(event, resetTimers);
    });

    startTimers();

    return () => {
      clearTimers();
      events.forEach((event) => {
        window.removeEventListener(event, resetTimers);
      });
    };
  }, []);

  return { showWarning, secondsRemaining, onStay: handleStay };
}

export function useTableUiState(storageKey: string, defaultState?: UiState) {
  // Start with undefined to prevent rendering before localStorage is loaded
  const [uiState, setUiState] = useState<UiState | undefined>(undefined);

  useEffect(() => {
    const stored = localStorage?.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUiState(parsed);
      } catch (e) {
        console.log(e);
        // On parse error, use defaultState
        setUiState(defaultState || { columnOrder: [], columnPinning: {}, columnSizing: {}, columnVisibility: {} });
      }
    } else {
      // No stored state, use defaultState
      setUiState(defaultState || { columnOrder: [], columnPinning: {}, columnSizing: {}, columnVisibility: {} });
    }
  }, [storageKey]); // Run once on mount

  const handleUiChange = useCallback((newUiState: UiState) => {
    setUiState((prev: UiState | undefined) => {
      const merged = { ...prev, ...newUiState };
      localStorage.setItem(storageKey, JSON.stringify(merged));
      return merged;
    });
  }, [storageKey]);

  return { uiState, handleUiChange };
}

