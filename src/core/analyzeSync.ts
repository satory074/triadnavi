import { chaosExactFeasible, createContext, rootMoves, runTask } from './analyze';
import { guaranteeKind, positionKey, type Position } from './position';
import { applyResult, createAnalysis, markIssued, nextTasks, type Analysis } from './scheduler';
import type { World } from './worlds';

export function startAnalysis(pos: Position, worlds: readonly World[]): Analysis {
  const kind = guaranteeKind(pos);
  return createAnalysis(
    positionKey(pos),
    kind,
    rootMoves(pos),
    worlds.length,
    worlds.every((w) => w.enumerated),
    chaosExactFeasible(pos),
  );
}

/** ワーカーを使わずに最後まで解く。テスト用、およびワーカーが使えない環境のためのフォールバック */
export function analyzeSync(pos: Position, worlds: World[]): Analysis {
  const ctx = createContext(pos, worlds);
  let a = startAnalysis(pos, worlds);
  for (;;) {
    const tasks = nextTasks(a, 1);
    if (tasks.length === 0) return a;
    a = markIssued(a, tasks);
    a = applyResult(a, runTask(ctx, tasks[0]));
  }
}
