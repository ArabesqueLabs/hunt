// A screen's data: loaded as it comes into view (and each time it does
// again, so it's never stale after another screen changed something),
// pulled down to refresh.

import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** Pulled down to refresh: loading again, with what's there still shown. */
  refreshing: boolean;
  refresh: () => void;
  /** Load again quietly (after a change). */
  reload: () => Promise<void>;
}

/** `key`: what the data depends on (a tab chosen): loaded again as it changes. */
export function useLoad<T>(load: () => Promise<T>, key?: unknown): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(load);
  latest.current = load;
  // Only the newest load's answer is kept.
  const run = useRef(0);

  const reload = useCallback(async () => {
    const n = ++run.current;
    try {
      const d = await latest.current();
      if (n === run.current) { setData(d); setError(null); }
    } catch (e) {
      if (n === run.current) setError((e as Error).message);
    }
  }, []);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setData(null);
    reload();
  }, [key, reload]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    reload().finally(() => setRefreshing(false));
  }, [reload]);

  return { data, error, refreshing, refresh, reload };
}

/** Run a change; its error, if it fails, as a message (shown with Alert). */
export async function attemptChange<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    Alert.alert("That didn't work", (e as Error).message);
    return undefined;
  }
}
