import { useCallback, useEffect, useRef, useState } from 'react';
import { runDeckTask, type DeckContext } from '../core/deckEval';
import { applyDeckResult, markDeckIssued, nextDeckTasks, type DeckSearch } from '../core/deckSearch';
import type { DeckWorkerRequest, DeckWorkerResponse } from '../worker/deckProtocol';

export interface DeckSearchRequest {
  /** 実行ごとに変える番号。同じ条件でやり直した時にも、前の実行の結果が混ざらないようにする */
  runId: number;
  context: DeckContext;
  start: DeckSearch;
}

export interface DeckSearchState {
  search: DeckSearch | null;
  running: boolean;
  error: string | null;
}

const IDLE: DeckSearchState = { search: null, running: false, error: null };

function workerCount(): number {
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(4, hc - 1));
}

function spawn(): Worker {
  return new Worker(new URL('../worker/deck.worker.ts', import.meta.url), { type: 'module' });
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

/**
 * デッキの探索をワーカープールで進める(useSolver と同じ作り。useSolver は対局中の本線でテストが無いので、共通化せずに写している)。
 * 探索は数分かかることがあるので、止めてもその時点の結果が残るようにしている。
 */
export function useDeckSearch(request: DeckSearchRequest | null): DeckSearchState & { stop: () => void } {
  const [state, setState] = useState<DeckSearchState>(IDLE);
  const slots = useRef<Slot[]>([]);
  const halt = useRef<() => void>(() => {});
  const key = request ? `${request.start.key}#${request.runId}` : '';

  // アンマウント時に全ワーカーを破棄
  useEffect(() => {
    const owned = slots;
    return () => {
      for (const s of owned.current) s.worker.terminate();
      owned.current = [];
    };
  }, []);

  useEffect(() => {
    if (!request) {
      setState(IDLE);
      return;
    }
    let search = request.start;
    let cancelled = false;
    let timer = 0;

    const killBusy = () => {
      slots.current = slots.current.filter((s) => {
        if (s.busy) s.worker.terminate();
        return !s.busy;
      });
    };

    // requestAnimationFrame は非表示のタブで発火しないので、タイマーで間引く(useSolver と同じ理由)
    const publish = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (!cancelled) setState((s) => ({ search, running: search.phase !== 'done', error: s.error }));
      }, 40);
    };

    halt.current = () => {
      if (cancelled) return;
      cancelled = true;
      if (timer) clearTimeout(timer);
      killBusy();
      setState((s) => ({ search, running: false, error: s.error }));
    };

    // ワーカーが使えない環境向け: メインスレッドで 1 タスクずつ、描画の合間に実行する
    const runOnMainThread = () => {
      if (cancelled) return;
      const [task] = nextDeckTasks(search, 1);
      if (!task) return publish();
      search = applyDeckResult(markDeckIssued(search, [task]), runDeckTask(request.context, task));
      publish();
      setTimeout(runOnMainThread, 0);
    };

    const dispatch = () => {
      if (cancelled) return;
      for (const slot of slots.current) {
        if (slot.busy) continue;
        const [task] = nextDeckTasks(search, 1);
        if (!task) break;
        search = markDeckIssued(search, [task]);
        slot.busy = true;
        slot.worker.postMessage({ type: 'task', key, task } satisfies DeckWorkerRequest);
      }
    };

    const attach = (slot: Slot) => {
      slot.worker.onmessage = (ev: MessageEvent<DeckWorkerResponse>) => {
        const msg = ev.data;
        if (cancelled || msg.key !== key) return;
        slot.busy = false;
        if (msg.type === 'error') {
          setState((s) => ({ ...s, error: msg.message }));
          return;
        }
        search = applyDeckResult(search, msg.result);
        publish();
        dispatch();
      };
      slot.worker.onerror = (ev) => {
        if (!cancelled) setState((s) => ({ ...s, error: ev.message || 'ワーカーでエラーが発生しました' }));
      };
      slot.worker.postMessage({ type: 'init', key, context: request.context } satisfies DeckWorkerRequest);
    };

    setState({ search, running: search.phase !== 'done', error: null });
    try {
      const n = workerCount();
      killBusy();
      while (slots.current.length < n) slots.current.push({ worker: spawn(), busy: false });
      slots.current.forEach(attach);
      dispatch();
    } catch {
      slots.current = [];
      setTimeout(runOnMainThread, 0);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      killBusy();
    };
    // request の中身は key に集約されている
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const stop = useCallback(() => halt.current(), []);
  return { ...state, stop };
}
