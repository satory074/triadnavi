import { FULL, type FastBoard } from './fastEngine';

/**
 * カオス: 各ターンに出すカードがランダムに強制される。プレイヤーが選べるのはマスだけ。
 */

export interface Dist {
  win: number;
  draw: number;
  loss: number;
}

const utility = (d: Dist) => d.win + 0.5 * d.draw;

function terminal(b: FastBoard): Dist {
  const v = b.myValue();
  return { win: v > 0 ? 1 : 0, draw: v === 0 ? 1 : 0, loss: v < 0 ? 1 : 0 };
}

/**
 * 厳密な期待値計算(相手の手札が全て既知の時)。双方の強制カードは一様な確率の節点で、
 * 各プレイヤーは自分の期待値(勝ち 1、引き分け 0.5)が最良になるマスを選ぶ。
 * 同一カードも別々の抽選結果なので重複排除しない。枝刈りはできない。
 */
function expect_(b: FastBoard): Dist {
  if (b.placed === 9) return terminal(b);
  const me = b.turn === 0;
  const hand = me ? b.hand0 : b.hand1;
  const acc: Dist = { win: 0, draw: 0, loss: 0 };
  let n = 0;
  for (let cm = hand; cm; cm &= cm - 1) {
    const card = 31 - Math.clz32(cm & -cm);
    const d = bestCell(b, card, me);
    acc.win += d.win;
    acc.draw += d.draw;
    acc.loss += d.loss;
    n++;
  }
  return { win: acc.win / n, draw: acc.draw / n, loss: acc.loss / n };
}

function bestCell(b: FastBoard, card: number, me: boolean): Dist {
  let best: Dist | null = null;
  for (let em = ~b.occ & FULL; em; em &= em - 1) {
    const cell = 31 - Math.clz32(em & -em);
    const flips = b.place(card, cell);
    const d = expect_(b);
    b.undo(card, cell, flips);
    if (best === null || (me ? utility(d) > utility(best) : utility(d) < utility(best))) best = d;
  }
  return best!;
}

/** 強制されたカード forced を各マスに置いた時の結果の分布 */
export function chaosExact(b: FastBoard, forced: number): { cell: number; dist: Dist }[] {
  const out: { cell: number; dist: Dist }[] = [];
  for (let em = ~b.occ & FULL; em; em &= em - 1) {
    const cell = 31 - Math.clz32(em & -em);
    const flips = b.place(forced, cell);
    out.push({ cell, dist: expect_(b) });
    b.undo(forced, cell, flips);
  }
  return out;
}

/** 厳密計算の残り経路数の上限(双方のカード抽選 × マス選択) */
export function chaosLeafCount(b: FastBoard): number {
  let n = 1;
  let empties = 9 - b.placed;
  let mine = popcount(b.hand0);
  let theirs = popcount(b.hand1);
  let turn = b.turn;
  let first = true;
  while (empties > 0) {
    const h = turn === 0 ? mine : theirs;
    n *= empties * (first ? 1 : h); // ルートのカードは強制済み
    first = false;
    if (turn === 0) mine--;
    else theirs--;
    turn ^= 1;
    empties--;
  }
  return n;
}

function popcount(x: number): number {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
}

/**
 * 悲観的下界: 自分の将来のカードは敵が選ぶとみなし、相手は手札から自由に選べるとみなす。
 * 「どのカードを引かされても」成り立つ保証値(枚数 − 5)。min と max が同じ手番に入るので negamax にできない。
 */
function pessMe(b: FastBoard, alpha: number, beta: number): number {
  if (b.placed === 9) return b.myValue();
  let v = 99;
  for (let cm = b.hand0; cm; cm &= cm - 1) {
    const card = 31 - Math.clz32(cm & -cm);
    if (b.dupMask[card] & b.hand0) continue;
    const inner = pessMyCells(b, card, alpha, Math.min(beta, v));
    if (inner < v) v = inner;
    if (v <= alpha) break;
  }
  return v;
}

function pessMyCells(b: FastBoard, card: number, alpha: number, beta: number): number {
  let best = -99;
  for (let em = ~b.occ & FULL; em; em &= em - 1) {
    const cell = 31 - Math.clz32(em & -em);
    const flips = b.place(card, cell);
    const x = pessOpp(b, Math.max(alpha, best), beta);
    b.undo(card, cell, flips);
    if (x > best) best = x;
    if (best >= beta) break;
  }
  return best;
}

function pessOpp(b: FastBoard, alpha: number, beta: number): number {
  if (b.placed === 9) return b.myValue();
  const cards = b.playable();
  let v = 99;
  for (let cm = cards; cm; cm &= cm - 1) {
    const card = 31 - Math.clz32(cm & -cm);
    if (b.dupMask[card] & cards) continue;
    for (let em = ~b.occ & FULL; em; em &= em - 1) {
      const cell = 31 - Math.clz32(em & -em);
      const flips = b.place(card, cell);
      const x = pessMe(b, alpha, Math.min(beta, v));
      b.undo(card, cell, flips);
      if (x < v) v = x;
      if (v <= alpha) return v;
    }
  }
  return v;
}

/** 強制カード forced を cell に置いた時の、最悪の引きでも保証される値が threshold 以上か */
export function chaosPessimisticAtLeast(b: FastBoard, forced: number, cell: number, threshold: number): boolean {
  const flips = b.place(forced, cell);
  const v = pessOpp(b, threshold - 1, threshold);
  b.undo(forced, cell, flips);
  return v >= threshold;
}
