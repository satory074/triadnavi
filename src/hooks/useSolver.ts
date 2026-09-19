import { useEffect, useRef, useState } from 'react';
import { createContext, runTask, type SolveContext } from '../core/analyze';
import { startAnalysis } from '../core/analyzeSync';
import { positionKey, type Position } from '../core/position';
import { applyResult, markIssued, nextTasks, progress, type Analysis } from '../core/scheduler';
import type { World } from '../core/worlds';
import type { WorkerRequest, WorkerResponse } from '../worker/protocol';

export interface SolverState {
  analysis: Analysis | null;
  done: number;
  total: number;
  complete: boolean;
  error: string | null;
}

const IDLE: SolverState = { analysis: null, done: 0, total: 0, complete: false, error: null };

function workerCount(): number {
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(4, hc - 1));
}

function spawn(): Worker {
  return new Worker(new URL('../worker/solver.worker.ts', import.meta.url), { type: 'module' });
}

interface Slot {
  worker: Worker;
  busy: boolean;
}

/**
 * 局面を渡すと、ワーカープールにタスクを配って解析結果を逐次返す。
 * 局面が変わったら、計算中のワーカーは terminate() して作り直す(同期処理の探索は他の方法では止められない)。
 */
export function useSolver(position: Position | null, worlds: World[]): SolverState {
  const [state, setState] = useState<SolverState>(IDLE);
  const slots = useRef<Slot[]>([]);
  const key = position ? positionKey(position) + '#' + worlds.length : '';

  // アンマウント時に全ワーカーを破棄
  useEffect(() => {
    const owned = slots;
    return () => {
      for (const s of owned.current) s.worker.terminate();
      owned.current = [];
    };
  }, []);

  useEffect(() => {
    if (!position) {
      setState(IDLE);
      return;
    }
    let analysis = startAnalysis(position, worlds);
    let cancelled = false;
    let frame = 0;

    // 結果は 1 秒に数百件届くことがあるので、画面への反映は間引く。
    // requestAnimationFrame は非表示のタブでは発火しない(ゲームの横で裏に回っている間に更新が止まる)のでタイマーを使う
    const publish = () => {
      if (frame) return;
      frame = window.setTimeout(() => {
        frame = 0;
        if (cancelled) return;
        const p = progress(analysis);
        setState({ analysis, done: p.done, total: p.total, complete: p.complete, error: null });
      }, 40);
    };

    // ワーカーが使えない環境向け: メインスレッドで 1 タスクずつ、描画の合間に実行する
    let fallbackCtx: SolveContext | null = null;
    const runOnMainThread = () => {
      if (cancelled) return;
      const [task] = nextTasks(analysis, 1);
      if (!task) return publish();
      fallbackCtx ??= createContext(position, worlds);
      analysis = applyResult(markIssued(analysis, [task]), runTask(fallbackCtx, task));
      publish();
      setTimeout(runOnMainThread, 0);
    };

    const dispatch = () => {
      if (cancelled) return;
      for (const slot of slots.current) {
        if (slot.busy) continue;
        const [task] = nextTasks(analysis, 1);
        if (!task) break;
        analysis = markIssued(analysis, [task]);
        slot.busy = true;
        slot.worker.postMessage({ type: 'task', key, task } satisfies WorkerRequest);
      }
    };

    const attach = (slot: Slot) => {
      slot.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (cancelled || msg.key !== key) return;
        slot.busy = false;
        if (msg.type === 'error') {
          setState((s) => ({ ...s, error: msg.message }));
          return;
        }
        analysis = applyResult(analysis, msg.result);
        publish();
        dispatch();
      };
      slot.worker.onerror = (ev) => {
        if (!cancelled) setState((s) => ({ ...s, error: ev.message || 'ワーカーでエラーが発生しました' }));
      };
      slot.worker.postMessage({ type: 'init', key, position, worlds } satisfies WorkerRequest);
    };

    try {
      const n = workerCount();
      // 計算中のワーカーは捨てて作り直す。待機中のものは再利用する
      slots.current = slots.current.filter((s) => {
        if (s.busy) s.worker.terminate();
        return !s.busy;
      });
      while (slots.current.length < n) slots.current.push({ worker: spawn(), busy: false });
      slots.current.forEach(attach);
      publish();
      dispatch();
    } catch {
      slots.current = [];
      publish();
      setTimeout(runOnMainThread, 0);
    }

    return () => {
      cancelled = true;
      if (frame) clearTimeout(frame);
    };
    // position と worlds の中身は key に集約されている
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
