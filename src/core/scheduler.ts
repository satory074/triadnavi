import type { Dist } from './chaos';
import type { Task, TaskResult, RootMove } from './analyze';
import type { GuaranteeKind } from './position';
import type { MistakeCount } from './search';
import type { Move, Outcome } from './types';

/** 世界ごとの結果の集計 */
export interface Tally {
  n: number;
  win: number;
  draw: number;
  loss: number;
}

export interface MoveEval {
  move: Move;
  staticScore: number;
  /** 保証される結果のクラス。'notWin' は「勝ちではない」までしか調べていない状態 */
  cls?: Outcome | 'notWin';
  /** 勝ちクラスの手の厳密値(枚数 − 5) */
  value?: number;
  mistakes?: MistakeCount;
  worlds?: Tally;
  /** カオスの厳密な結果分布 */
  chaos?: Dist;
  /** カオスで、どのカードを引かされても保証される結果 */
  pessimistic?: Outcome;
}

export interface Analysis {
  key: string;
  kind: GuaranteeKind;
  moves: MoveEval[];
  worldCount: number;
  worldsEnumerated: boolean;
  chaosExact: boolean;
  /** 上位集合の探索ができるか(候補が足りているか)。できない時は保証に関わるタスクを発行しない */
  supersetOk: boolean;
  tasks: Record<string, 'issued' | 'done'>;
}

export function createAnalysis(
  key: string,
  kind: GuaranteeKind,
  roots: readonly RootMove[],
  worldCount: number,
  worldsEnumerated: boolean,
  chaosExact: boolean,
  supersetOk: boolean,
): Analysis {
  return {
    key,
    kind,
    moves: roots.map((r) => ({ move: r.move, staticScore: r.staticScore })),
    worldCount,
    worldsEnumerated,
    chaosExact,
    supersetOk,
    tasks: {},
  };
}

const mv = (m: Move) => `${m.card}.${m.cell}`;

const CLASS_RANK: Record<string, number> = { win: 3, draw: 2, notWin: 1.5, loss: 1 };

export function topClass(a: Analysis): Outcome | undefined {
  let best: Outcome | undefined;
  for (const m of a.moves) {
    if (m.cls === undefined || m.cls === 'notWin') continue;
    if (best === undefined || CLASS_RANK[m.cls] > CLASS_RANK[best]) best = m.cls;
  }
  return best;
}

/** 今の状態で実行してよいタスクを優先順に並べる(発行済み・完了済みも含む) */
function plan(a: Analysis): Task[] {
  const out: Task[] = [];
  const worldTasks = (moves: MoveEval[]) => {
    // 世界を外側のループにする: どの手も同じ世界の集合で比べられるように、1 つの世界を全ての手で解いてから次へ
    for (let w = 0; w < a.worldCount; w++) {
      for (const m of moves) out.push({ id: `w:${w}:${mv(m.move)}`, kind: 'world', world: w, move: m.move });
    }
  };

  if (a.kind === 'chaos') {
    if (a.chaosExact) out.push({ id: 'chaosExact', kind: 'chaosExact' });
    else worldTasks(a.moves);
    if (a.supersetOk) for (const m of a.moves) out.push({ id: `p:${mv(m.move)}`, kind: 'chaosPess', move: m.move });
    return out;
  }
  if (a.kind === 'estimate') {
    worldTasks(a.moves);
    return out;
  }

  // 段階 1: 保証クラスの分類。勝ちの手が 1 つ見つかった後は「勝ちかどうか」だけ調べれば所属が決まる
  const anyWin = a.moves.some((m) => m.cls === 'win');
  for (const m of a.moves) {
    out.push({ id: `c:${mv(m.move)}`, kind: 'classify', move: m.move, mode: anyWin ? 'winOnly' : 'full' });
  }
  if (a.moves.some((m) => m.cls === undefined)) return out;

  // 段階 2: 最上位クラスの手だけ、同点の中の順位付け
  const top = topClass(a);
  const members = a.moves.filter((m) => m.cls === top);
  if (top === 'win') {
    for (const m of members) out.push({ id: `m:${mv(m.move)}`, kind: 'margin', move: m.move });
  } else if (a.kind === 'exact') {
    for (const m of members) {
      out.push({ id: `e:${mv(m.move)}`, kind: 'mistakes', move: m.move, needDraw: top === 'loss' });
    }
  } else {
    worldTasks(members);
  }

  // 段階 3: 表の表示用に、「勝ちではない」止まりの手を引き分け/負けに分ける
  for (const m of a.moves) {
    if (m.cls === 'notWin' || a.tasks[`d:${mv(m.move)}`]) {
      out.push({ id: `d:${mv(m.move)}`, kind: 'classify', move: m.move, mode: 'drawOnly' });
    }
  }
  return out;
}

/** 未発行のタスクを最大 n 個返す */
export function nextTasks(a: Analysis, n: number): Task[] {
  const out: Task[] = [];
  for (const t of plan(a)) {
    if (out.length >= n) break;
    if (!a.tasks[t.id]) out.push(t);
  }
  return out;
}

export function markIssued(a: Analysis, tasks: readonly Task[]): Analysis {
  if (tasks.length === 0) return a;
  const next = { ...a.tasks };
  for (const t of tasks) next[t.id] = 'issued';
  return { ...a, tasks: next };
}

export function applyResult(a: Analysis, r: TaskResult): Analysis {
  const tasks = { ...a.tasks, [r.id]: 'done' as const };
  const update = (move: Move, f: (m: MoveEval) => MoveEval): MoveEval[] =>
    a.moves.map((m) => (m.move.card === move.card && m.move.cell === move.cell ? f(m) : m));

  switch (r.kind) {
    case 'classify':
      return { ...a, tasks, moves: update(r.move, (m) => ({ ...m, cls: r.cls })) };
    case 'mistakes':
      return { ...a, tasks, moves: update(r.move, (m) => ({ ...m, mistakes: r.count })) };
    case 'margin':
      return { ...a, tasks, moves: update(r.move, (m) => ({ ...m, value: r.value })) };
    case 'world':
      return {
        ...a,
        tasks,
        moves: update(r.move, (m) => {
          const t = m.worlds ?? { n: 0, win: 0, draw: 0, loss: 0 };
          return { ...m, worlds: { ...t, n: t.n + 1, [r.cls]: t[r.cls] + 1 } };
        }),
      };
    case 'chaosExact':
      return {
        ...a,
        tasks,
        moves: a.moves.map((m) => {
          const d = r.dists.find((x) => x.cell === m.move.cell);
          return d ? { ...m, chaos: d.dist } : m;
        }),
      };
    case 'chaosPess':
      return { ...a, tasks, moves: update(r.move, (m) => ({ ...m, pessimistic: r.cls })) };
  }
}

export function progress(a: Analysis): { done: number; total: number; complete: boolean } {
  const ids = new Set(Object.keys(a.tasks));
  for (const t of plan(a)) ids.add(t.id);
  let done = 0;
  for (const id of ids) if (a.tasks[id] === 'done') done++;
  return { done, total: ids.size, complete: ids.size > 0 && done === ids.size };
}
