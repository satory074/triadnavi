import { FULL, type FastBoard } from './fastEngine';

/**
 * 全深さの negamax + アルファベータ。値は「手番側から見た (枚数 − 5)」で、範囲は [-5, 5]。
 * 置換表と探索木内の手の並べ替えは入れていない(2 回の計測でどちらも効果が無いか逆効果だった)。
 */

export const searchStats = { nodes: 0 };

const NEG_INF = -99;

export interface FastMove {
  card: number;
  cell: number;
}

export function negamax(b: FastBoard, alpha: number, beta: number): number {
  searchStats.nodes++;
  if (b.placed === 9) {
    const v = b.myValue();
    return b.turn === 0 ? v : -v;
  }
  const cards = b.playable();
  const dup = b.dupMask;
  const empties = ~b.occ & FULL;
  let best = NEG_INF;
  for (let cm = cards; cm; cm &= cm - 1) {
    const card = 31 - Math.clz32(cm & -cm);
    // 同一のカードが前にまだ手札にあれば、同じ結果になるので飛ばす
    if (dup[card] & cards) continue;
    for (let em = empties; em; em &= em - 1) {
      const cell = 31 - Math.clz32(em & -em);
      const flips = b.place(card, cell);
      const v = -negamax(b, -beta, -alpha);
      // 枝刈りの判定より前に必ず戻す(先に return すると盤面が黙って壊れる)
      b.undo(card, cell, flips);
      if (v > best) {
        best = v;
        if (v > alpha) {
          alpha = v;
          if (alpha >= beta) return best;
        }
      }
    }
  }
  return best;
}

/** テスト用: 枝刈りも重複排除もしない全探索 */
export function bruteForce(b: FastBoard): number {
  if (b.placed === 9) {
    const v = b.myValue();
    return b.turn === 0 ? v : -v;
  }
  const cards = b.playable();
  const empties = ~b.occ & FULL;
  let best = NEG_INF;
  for (let cm = cards; cm; cm &= cm - 1) {
    const card = 31 - Math.clz32(cm & -cm);
    for (let em = empties; em; em &= em - 1) {
      const cell = 31 - Math.clz32(em & -em);
      const flips = b.place(card, cell);
      const v = -bruteForce(b);
      b.undo(card, cell, flips);
      if (v > best) best = v;
    }
  }
  return best;
}

/** 手番側の合法手(同一カードは重複排除)。forcedCard を指定するとそのカードだけ */
export function legalMoves(b: FastBoard, forcedCard = -1): FastMove[] {
  const cards = forcedCard >= 0 ? 1 << forcedCard : b.playable();
  const moves: FastMove[] = [];
  for (let cm = cards; cm; cm &= cm - 1) {
    const card = 31 - Math.clz32(cm & -cm);
    if (b.dupMask[card] & cards) continue;
    for (let em = ~b.occ & FULL; em; em &= em - 1) {
      moves.push({ card, cell: 31 - Math.clz32(em & -em) });
    }
  }
  return moves;
}

/**
 * 自分(プレイヤー 0)から見た値が threshold 以上か。手番がどちらでも使える幅ゼロの窓の探り。
 * 相手の手番では、相手から見た値が -threshold 以下かを調べる。
 */
export function myValueAtLeast(b: FastBoard, threshold: number): boolean {
  if (b.turn === 0) return negamax(b, threshold - 1, threshold) >= threshold;
  return -negamax(b, -threshold, -threshold + 1) >= threshold;
}

/** 手 m の値が threshold 以上か(幅ゼロの窓の探り)。値は手番側の視点 */
export function probeMove(b: FastBoard, m: FastMove, threshold: number): boolean {
  const flips = b.place(m.card, m.cell);
  const v = -negamax(b, -threshold, -threshold + 1);
  b.undo(m.card, m.cell, flips);
  return v >= threshold;
}

/** 手 m の厳密値。真の値が [lo, hi] の外なら、その側の境界以遠の値が返る(fail-soft) */
export function exactMove(b: FastBoard, m: FastMove, lo: number, hi: number): number {
  const flips = b.place(m.card, m.cell);
  const v = -negamax(b, -hi, -lo);
  b.undo(m.card, m.cell, flips);
  return v;
}

/** moves の中に、値が threshold 以上の手があるか。見つかった最初の手を返す */
export function probeRoot(b: FastBoard, moves: readonly FastMove[], threshold: number): FastMove | null {
  for (const m of moves) if (probeMove(b, m, threshold)) return m;
  return null;
}

export interface MistakeCount {
  /** 相手の応手の数(同一カードは 1 つに数える) */
  replies: number;
  /** そのうち、自分の勝ちが確定する応手の数 */
  toWin: number;
  /** そのうち、引き分け以上が確定する応手の数(toWin を含む) */
  toDrawOrBetter: number;
}

/**
 * 手 m の後、相手の各応手について自分の保証結果を調べる(相手が次の 1 手を誤る場合のモデル)。
 * needDraw が false なら、引き分け以上の判定は省いて replies と同数とみなす(m が引き分け以上を保証する場合)。
 */
export function countMistakes(b: FastBoard, m: FastMove, needDraw: boolean): MistakeCount {
  const flips = b.place(m.card, m.cell);
  const out: MistakeCount = { replies: 0, toWin: 0, toDrawOrBetter: 0 };
  if (b.placed < 9) {
    for (const r of legalMoves(b)) {
      const f = b.place(r.card, r.cell);
      out.replies++;
      if (negamax(b, 0, 1) >= 1) {
        out.toWin++;
        out.toDrawOrBetter++;
      } else if (!needDraw || negamax(b, -1, 0) >= 0) {
        out.toDrawOrBetter++;
      }
      b.undo(r.card, r.cell, f);
    }
  }
  b.undo(m.card, m.cell, flips);
  return out;
}
