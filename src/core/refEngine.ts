import { NEIGHBOUR, opposite } from './geometry';
import { typeSign } from './rules';
import type { CardDef, EngineOptions, Player, RuleSet } from './types';

/**
 * 参照エンジン。読みやすさと正しさを優先した不変データの実装で、UI はこちらを使う。
 * 探索用の fastEngine.ts とは性質テストで突き合わせる。
 *
 * 設置処理の順序(FFTriadBuddy と同じ。実機観察で修正されてきた実装):
 *   設置 → セイム/プラス判定 + 通常支配 → (セイム/プラスで取れた場合のみ)コンボ連鎖 → タイプ枚数の更新
 * タイプ補正は「置くカード自身を含めない枚数」で全ての比較を行い、解決が終わってから枚数を増やす。
 */

export interface RefCell {
  readonly card: number;
  readonly owner: Player;
}

export interface RefState {
  readonly cards: readonly CardDef[];
  readonly board: readonly (RefCell | null)[];
  /** タイプごとの盤面の枚数。添字 0(タイプなし)は常に 0 */
  readonly typeCount: readonly number[];
  readonly rules: RuleSet;
  readonly options: EngineOptions;
}

export type FlipCause = 'basic' | 'same' | 'plus' | 'combo';

export interface Flip {
  readonly cell: number;
  readonly cause: FlipCause;
  /** 0 = 置いたカードによるもの、1 以上 = コンボの連鎖数 */
  readonly gen: number;
}

export function emptyState(cards: readonly CardDef[], rules: RuleSet, options: EngineOptions): RefState {
  return { cards, board: Array<RefCell | null>(9).fill(null), typeCount: [0, 0, 0, 0, 0], rules, options };
}

/** タイプ補正後の辺の値。[1, 10] にクランプ(「11」は A と同値で、A には勝てない) */
export function effectiveSide(card: CardDef, dir: number, typeCount: readonly number[], rules: RuleSet): number {
  const shift = card.type === 0 ? 0 : typeSign(rules) * typeCount[card.type];
  return Math.min(10, Math.max(1, card.sides[dir] + shift));
}

/** 攻撃側の値 a が防御側の値 b を支配できるか。エースキラーは攻撃側にだけ効く一方向の例外 */
export function captures(a: number, b: number, reverse: boolean, fallenAce: boolean): boolean {
  if (reverse) return a < b || (fallenAce && a === 10 && b === 1);
  return a > b || (fallenAce && a === 1 && b === 10);
}

export function placeRef(
  state: RefState,
  by: Player,
  card: number,
  cell: number,
): { state: RefState; flips: Flip[] } {
  if (state.board[cell] !== null) throw new Error(`cell ${cell} is occupied`);
  const { cards, rules, options, typeCount } = state;
  const board: (RefCell | null)[] = state.board.slice();
  board[cell] = { card, owner: by };

  const value = (c: number, d: number) => effectiveSide(cards[c], d, typeCount, rules);

  interface Nb { cell: number; a: number; b: number; opp: boolean }
  const nbs: Nb[] = [];
  for (let d = 0; d < 4; d++) {
    const n = NEIGHBOUR[cell * 4 + d];
    if (n < 0) continue;
    const other = board[n];
    if (!other) continue;
    nbs.push({ cell: n, a: value(card, d), b: value(other.card, opposite(d)), opp: other.owner !== by });
  }

  // セイム/プラス: 自分のカードも「2辺以上」の条件に数えるが、裏返るのは相手のカードだけ
  const special = new Map<number, FlipCause>();
  if (rules.same) {
    const matches = nbs.filter((x) => x.a === x.b);
    if (matches.length >= 2) for (const m of matches) if (m.opp) special.set(m.cell, 'same');
  }
  if (rules.plus) {
    for (let i = 0; i < nbs.length; i++) {
      for (let j = i + 1; j < nbs.length; j++) {
        if (nbs[i].a + nbs[i].b !== nbs[j].a + nbs[j].b) continue;
        for (const x of [nbs[i], nbs[j]]) if (x.opp && !special.has(x.cell)) special.set(x.cell, 'plus');
      }
    }
  }

  const flips: Flip[] = [];
  for (const [c, cause] of special) flips.push({ cell: c, cause, gen: 0 });
  for (const x of nbs) {
    if (!x.opp || special.has(x.cell)) continue;
    if (captures(x.a, x.b, rules.reverse, rules.fallenAce)) flips.push({ cell: x.cell, cause: 'basic', gen: 0 });
  }
  for (const f of flips) board[f.cell] = { card: board[f.cell]!.card, owner: by };

  // コンボ: セイム/プラスで取ったカードだけが起点。通常ルールのみで連鎖し、セイム/プラスは再発動しない
  let frontier = [...special.keys()];
  const comboFallenAce = rules.fallenAce && options.fallenAceInCombo;
  for (let gen = 1; frontier.length > 0; gen++) {
    const next: number[] = [];
    for (const c of frontier) {
      for (let d = 0; d < 4; d++) {
        const n = NEIGHBOUR[c * 4 + d];
        if (n < 0) continue;
        const other = board[n];
        if (!other || other.owner === by) continue;
        if (captures(value(board[c]!.card, d), value(other.card, opposite(d)), rules.reverse, comboFallenAce)) {
          board[n] = { card: other.card, owner: by };
          flips.push({ cell: n, cause: 'combo', gen });
          next.push(n);
        }
      }
    }
    frontier = next;
  }

  // 全ての解決が終わってからタイプ枚数を増やす
  const nextCount = typeCount.slice();
  const t = cards[card].type;
  if (t !== 0) nextCount[t]++;

  return { state: { cards, board, typeCount: nextCount, rules, options }, flips };
}

export function isFull(state: RefState): boolean {
  return state.board.every((c) => c !== null);
}

/**
 * 10 枚での採点。盤面 9 枚 + 後攻の手元に残る 1 枚。盤面が埋まった状態で呼ぶこと。
 * first は先攻のプレイヤー。
 */
export function scoreRef(state: RefState, first: Player): { me: number; opp: number } {
  let me = 0;
  let opp = 0;
  for (const c of state.board) {
    if (!c) continue;
    if (c.owner === 0) me++;
    else opp++;
  }
  if (first === 0) opp++;
  else me++;
  return { me, opp };
}
