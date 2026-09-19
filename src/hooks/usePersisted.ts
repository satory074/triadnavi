import { useCallback, useState } from 'react';

/** localStorage への保存つきの状態。読み込み時の検証は parse に委ねる */
export function usePersisted<T>(key: string, parse: (raw: string | null) => T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return parse(localStorage.getItem(key));
    } catch {
      return parse(null);
    }
  });

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // プライベートブラウズ等で保存できなくても動作は続ける
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, set];
}
