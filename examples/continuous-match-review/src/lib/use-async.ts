import { useCallback, useEffect, useState } from "react";

export type AsyncState<T> = {
  data?: T;
  error?: Error;
  loading: boolean;
  /** Loads again, keeping the current data on screen meanwhile. */
  reload: () => void;
};

/** Runs `load` whenever `deps` change; results of superseded runs are dropped. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<Omit<AsyncState<T>, "reload">>({ loading: true });
  const [run, setRun] = useState(0);

  useEffect(() => {
    let current = true;
    setState((previous) => ({ ...previous, loading: true }));
    load().then(
      (data) => current && setState({ data, loading: false }),
      (error: Error) => current && setState((previous) => ({ ...previous, error, loading: false })),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, run]);

  const reload = useCallback(() => setRun((n) => n + 1), []);
  return { ...state, reload };
}

/** Calls `callback` every `ms` while the tab is visible. */
export function useInterval(callback: () => void, ms: number | null) {
  useEffect(() => {
    if (ms === null) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") callback();
    }, ms);
    return () => clearInterval(timer);
  }, [callback, ms]);
}
