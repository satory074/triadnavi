import { chaosExact, chaosLeafCount, chaosPessimisticAtLeast, type Dist } from './chaos';
import type { FastBoard } from './fastEngine';
import { NEIGHBOUR } from './geometry';
import { guaranteeKind, poolIsSufficient, toFastBoard, type FastMapping, type GuaranteeKind, type Position } from './position';
import { BIT_REVERSE } from './rules';
import { countMistakes, exactMove, legalMoves, probeMove, type FastMove, type MistakeCount } from './search';
import type { Move, Outcome } from './types';
import { applyWorld, type World } from './worlds';

/**
 * 解析はタスク単位の純関数。メインスレッドのスケジューラ(scheduler.ts)がタスクを配り、
 * ワーカーが runTask を実行する。1 タスク = 初手 1 つ × 計算 1 種類なので、進捗表示と並列化がそのまま得られる。
 */

export type ClassifyMode = 'full' | 'winOnly' | 'drawOnly';

export type Task =
  | { id: string; kind: 'classify'; move: Move; mode: ClassifyMode }
  | { id: string; kind: 'mistakes'; move: Move; needDraw: boolean }
  | { id: string; kind: 'margin'; move: Move }
  | { id: string; kind: 'world'; world: number; move: Move }
  | { id: string; kind: 'chaosExact' }
  | { id: string; kind: 'chaosPess'; move: Move };

export type TaskResult =
  | { id: string; kind: 'classify'; move: Move; cls: Outcome | 'notWin' }
  | { id: string; kind: 'mistakes'; move: Move; count: MistakeCount }
  | { id: string; kind: 'margin'; move: Move; value: number }
  | { id: string; kind: 'world'; world: number; move: Move; cls: Outcome }
  | { id: string; kind: 'chaosExact'; dists: { cell: number; dist: Dist }[] }
  | { id: string; kind: 'chaosPess'; move: Move; cls: Outcome };

export interface SolveContext {
  pos: Position;
  worlds: World[];
  kind: GuaranteeKind;
  main: FastMapping | null;
  worldMaps: Map<number, FastMapping>;
}

export function createContext(pos: Position, worlds: World[]): SolveContext {
  const kind = guaranteeKind(pos);
  // 候補が足りない時は上位集合の探索ができない(相手の出すカードが尽きて値が壊れる)ので、メインの盤面は作らない
  const main = poolIsSufficient(pos) ? toFastBoard(pos) : null;
  return { pos, worlds, kind, main, worldMaps: new Map() };
}

function worldMap(ctx: SolveContext, w: number): FastMapping {
  let m = ctx.worldMaps.get(w);
  if (!m) {
    m = toFastBoard(applyWorld(ctx.pos, ctx.worlds[w]));
    ctx.worldMaps.set(w, m);
  }
  return m;
}

function fastMove(map: FastMapping, move: Move): FastMove {
  return { card: map.toFast[move.card], cell: move.cell };
}

function classify(b: FastBoard, m: FastMove, mode: ClassifyMode): Outcome | 'notWin' {
  if (mode !== 'drawOnly' && probeMove(b, m, 1)) return 'win';
  if (mode === 'winOnly') return 'notWin';
  return probeMove(b, m, 0) ? 'draw' : 'loss';
}

export function runTask(ctx: SolveContext, task: Task): TaskResult {
  switch (task.kind) {
    case 'classify': {
      const map = ctx.main!;
      return { id: task.id, kind: 'classify', move: task.move, cls: classify(map.board, fastMove(map, task.move), task.mode) };
    }
    case 'mistakes': {
      const map = ctx.main!;
      return { id: task.id, kind: 'mistakes', move: task.move, count: countMistakes(map.board, fastMove(map, task.move), task.needDraw) };
    }
    case 'margin': {
      const map = ctx.main!;
      return { id: task.id, kind: 'margin', move: task.move, value: exactMove(map.board, fastMove(map, task.move), 1, 5) };
    }
    case 'world': {
      const map = worldMap(ctx, task.world);
      const cls = classify(map.board, fastMove(map, task.move), 'full') as Outcome;
      return { id: task.id, kind: 'world', world: task.world, move: task.move, cls };
    }
    case 'chaosExact': {
      const map = ctx.main!;
      return { id: task.id, kind: 'chaosExact', dists: chaosExact(map.board, map.toFast[ctx.pos.forcedCard!]) };
    }
    case 'chaosPess': {
      const map = ctx.main!;
      const forced = map.toFast[task.move.card];
      const cls: Outcome = chaosPessimisticAtLeast(map.board, forced, task.move.cell, 1)
        ? 'win'
        : chaosPessimisticAtLeast(map.board, forced, task.move.cell, 0)
          ? 'draw'
          : 'loss';
      return { id: task.id, kind: 'chaosPess', move: task.move, cls };
    }
  }
}

/** カオスの厳密計算が現実的な時間で終わるか(相手の手札が全て既知で、残り経路が少ない) */
export const CHAOS_EXACT_LEAF_LIMIT = 3_000_000;

export function chaosExactFeasible(pos: Position): boolean {
  if (pos.rules.pick !== 'chaos' || pos.oppUnknown !== 0 || pos.forcedCard === undefined) return false;
  return chaosLeafCount(toFastBoard(pos).board) <= CHAOS_EXACT_LEAF_LIMIT;
}

export interface RootMove {
  move: Move;
  /** 有望な手から先に計算するための静的な評価。順位付けの最後のタイブレークにも使う */
  staticScore: number;
}

/** 自分の合法手(同一カードは重複排除)を、静的に有望な順で返す */
export function rootMoves(pos: Position): RootMove[] {
  if (pos.turn !== 0) return [];
  // 静的評価には相手の手札が要らないので、不明スロットを無視した盤面で計算する
  const map = toFastBoard({ ...pos, oppPool: [], oppUnknown: 0 });
  const b = map.board;
  const forced = pos.forcedCard === undefined ? -1 : map.toFast[pos.forcedCard];
  const reverse = (b.ruleBits & BIT_REVERSE) !== 0;
  const out = legalMoves(b, forced).map((m) => ({
    move: { card: map.toPos[m.card], cell: m.cell },
    staticScore: staticScore(b, m, reverse),
  }));
  return out.sort((x, y) => y.staticScore - x.staticScore || x.move.card - y.move.card || x.move.cell - y.move.cell);
}

function staticScore(b: FastBoard, m: FastMove, reverse: boolean): number {
  const flips = b.place(m.card, m.cell);
  let captured = 0;
  for (let f = flips; f; f &= f - 1) captured++;
  b.undo(m.card, m.cell, flips);
  // 空きマスに面した辺は攻められる。壁や埋まったマスに面した辺は安全(11 点)
  let safety = 0;
  for (let d = 0; d < 4; d++) {
    const n = NEIGHBOUR[m.cell * 4 + d];
    const exposed = n >= 0 && !((b.occ >>> n) & 1);
    const v = b.sides[m.card * 4 + d];
    safety += exposed ? (reverse ? 11 - v : v) : 11;
  }
  return captured * 100 + safety;
}
