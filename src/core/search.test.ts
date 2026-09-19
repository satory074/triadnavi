import { describe, expect, it } from 'vitest';
import { FastBoard, type FastSetup } from './fastEngine';
import { makeRng, type Rng } from './rng';
import { toRuleBits, typeSign } from './rules';
import { bruteForce, countMistakes, exactMove, legalMoves, negamax, probeMove } from './search';
import type { CardDef, CardType, Player, RuleSet } from './types';

const ALPHABETS = [
  [1, 2, 3, 9, 10],
  [4, 5, 6],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [7, 8, 9, 10],
];

function randomCards(r: Rng, n: number, dupes: boolean): CardDef[] {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const alpha = pick(ALPHABETS);
  const typed = r() < 0.5;
  const cards: CardDef[] = [];
  for (let i = 0; i < n; i++) {
    if (dupes && i > 0 && r() < 0.35) {
      cards.push(cards[Math.floor(r() * i)]);
      continue;
    }
    const type = (typed && r() < 0.7 ? 1 + Math.floor(r() * 2) : 0) as CardType;
    cards.push({ sides: [pick(alpha), pick(alpha), pick(alpha), pick(alpha)], type });
  }
  return cards;
}

function randomRules(r: Rng): RuleSet {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  return {
    same: r() < 0.5,
    plus: r() < 0.5,
    reverse: r() < 0.3,
    fallenAce: r() < 0.3,
    typeShift: pick(['asc', 'desc', 'none'] as const),
    pick: 'free',
    open: 'all',
    suddenDeath: false,
  };
}

function setupOf(cards: CardDef[], rules: RuleSet, first: Player, extra: Partial<FastSetup> = {}): FastSetup {
  return {
    cards,
    myHand: [0, 1, 2, 3, 4],
    oppKnown: [5, 6, 7, 8, 9],
    oppPool: [],
    poolQuota: 0,
    board: Array(9).fill(null),
    turn: first,
    first,
    ruleBits: toRuleBits(rules, { fallenAceInCombo: true }),
    sign: typeSign(rules),
    orderMe: false,
    orderOpp: false,
    ...extra,
  };
}

/** ランダムに k 手進める */
function advance(b: FastBoard, r: Rng, k: number): void {
  for (let i = 0; i < k; i++) {
    const moves = legalMoves(b);
    const m = moves[Math.floor(r() * moves.length)];
    b.place(m.card, m.cell);
  }
}

describe('negamax', () => {
  it('枝刈りなしの全探索と一致し、探索後に盤面が変わらない(重複カード・オーダーを含む)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 400; i++) {
      const first = (r() < 0.5 ? 0 : 1) as Player;
      const order = r() < 0.25;
      const b = new FastBoard(
        setupOf(randomCards(r, 10, true), randomRules(r), first, { orderMe: order, orderOpp: order && r() < 0.5 }),
      );
      advance(b, r, 4 + Math.floor(r() * 5));
      const snap = b.snapshot();
      const exact = bruteForce(b);
      expect(negamax(b, -99, 99)).toBe(exact);
      expect(b.snapshot()).toBe(snap);
    }
  });

  it('値は [-5, 5] に収まり、終局では 10 枚で数える', () => {
    const r = makeRng(11);
    for (let i = 0; i < 100; i++) {
      const b = new FastBoard(setupOf(randomCards(r, 10, false), randomRules(r), (i % 2) as Player));
      advance(b, r, 9);
      expect(b.placed).toBe(9);
      const v = negamax(b, -99, 99);
      expect(Math.abs(v)).toBeLessThanOrEqual(5);
      expect(b.myCount()).toBeGreaterThanOrEqual(0);
      expect(b.myCount()).toBeLessThanOrEqual(10);
    }
  });
});

describe('ルートの探り', () => {
  it('探りによる分類が厳密値と一致する', () => {
    const r = makeRng(13);
    for (let i = 0; i < 150; i++) {
      const b = new FastBoard(setupOf(randomCards(r, 10, true), randomRules(r), 0));
      advance(b, r, 4 + 2 * Math.floor(r() * 2)); // 自分の手番になる偶数手
      expect(b.turn).toBe(0);
      const snap = b.snapshot();
      for (const m of legalMoves(b)) {
        const v = exactMove(b, m, -99, 99);
        expect(probeMove(b, m, 1)).toBe(v >= 1);
        expect(probeMove(b, m, 0)).toBe(v >= 0);
        // 窓を絞った厳密値: 真の値が窓の中なら一致する
        if (v >= 1) expect(exactMove(b, m, 1, 5)).toBe(v);
      }
      expect(b.snapshot()).toBe(snap);
    }
  });

  it('相手の応手ごとの保証結果を数える', () => {
    const r = makeRng(17);
    for (let i = 0; i < 80; i++) {
      const b = new FastBoard(setupOf(randomCards(r, 10, false), randomRules(r), 0));
      advance(b, r, 4);
      const snap = b.snapshot();
      for (const m of legalMoves(b)) {
        const got = countMistakes(b, m, true);
        // 素朴に数え直す
        const f = b.place(m.card, m.cell);
        let replies = 0;
        let toWin = 0;
        let toDraw = 0;
        for (const reply of legalMoves(b)) {
          const g = b.place(reply.card, reply.cell);
          const v = bruteForce(b); // 自分の手番なので自分視点
          b.undo(reply.card, reply.cell, g);
          replies++;
          if (v >= 1) toWin++;
          if (v >= 0) toDraw++;
        }
        b.undo(m.card, m.cell, f);
        expect(got).toEqual({ replies, toWin, toDrawOrBetter: toDraw });
        // m の保証値は、相手の最善の応手に対する値
        const value = exactMove(b, m, -99, 99);
        expect(value >= 1).toBe(toWin === replies);
        expect(value >= 0).toBe(toDraw === replies);
      }
      expect(b.snapshot()).toBe(snap);
    }
  });
});

describe('上位集合モデル(非公開手札)', () => {
  const subsets = <T,>(xs: T[], k: number): T[][] => {
    if (k === 0) return [[]];
    if (xs.length < k) return [];
    const [h, ...t] = xs;
    return [...subsets(t, k - 1).map((s) => [h, ...s]), ...subsets(t, k)];
  };

  it('上位集合の値は、どの具体的な手札に対する値よりも大きくない(= 保証として健全)', () => {
    const r = makeRng(19);
    let strictlyLower = 0;
    for (let i = 0; i < 60; i++) {
      const rules = randomRules(r);
      const known = 2 + Math.floor(r() * 2); // 既知 2〜3 枚
      const quota = 5 - known;
      const poolSize = quota + 1 + Math.floor(r() * 2);
      const cards = randomCards(r, 5 + known + poolSize, false);
      const knownIdx = Array.from({ length: known }, (_, k) => 5 + k);
      const poolIdx = Array.from({ length: poolSize }, (_, k) => 5 + known + k);
      const first = (r() < 0.5 ? 0 : 1) as Player;

      const superB = new FastBoard(
        setupOf(cards, rules, first, { oppKnown: knownIdx, oppPool: poolIdx, poolQuota: quota }),
      );
      // 自分の手だけ 2 手進める代わりに、初手からだと重いので、相手の既知カードと自分のカードで 3 手進める
      const script: [number, number][] = [];
      const seq = makeRng(1000 + i);
      for (let ply = 0; ply < 3; ply++) {
        const mine = superB.turn === 0;
        const hand = mine ? [0, 1, 2, 3, 4] : knownIdx;
        const avail = hand.filter((c) => ((mine ? superB.hand0 : superB.hand1) >>> c) & 1);
        const card = avail[Math.floor(seq() * avail.length)];
        const empties = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((c) => !((superB.occ >>> c) & 1));
        const cell = empties[Math.floor(seq() * empties.length)];
        superB.place(card, cell);
        script.push([card, cell]);
      }
      const sign = superB.turn === 0 ? 1 : -1;
      const superValue = sign * negamax(superB, -99, 99);

      for (const hand of subsets(poolIdx, quota)) {
        const concrete = new FastBoard(setupOf(cards, rules, first, { oppKnown: [...knownIdx, ...hand] }));
        for (const [card, cell] of script) concrete.place(card, cell);
        const value = sign * negamax(concrete, -99, 99);
        expect(superValue).toBeLessThanOrEqual(value);
        if (superValue < value) strictlyLower++;
      }
    }
    // 緩和が実際に効いている(常に等しいわけではない)ことの確認
    expect(strictlyLower).toBeGreaterThan(0);
  });

  it('候補がちょうど残り枠の枚数なら、具体的な手札と同じ値になる', () => {
    const r = makeRng(23);
    for (let i = 0; i < 40; i++) {
      const rules = randomRules(r);
      const cards = randomCards(r, 10, false);
      const first = (r() < 0.5 ? 0 : 1) as Player;
      const a = new FastBoard(setupOf(cards, rules, first, { oppKnown: [5, 6, 7], oppPool: [8, 9], poolQuota: 2 }));
      const b = new FastBoard(setupOf(cards, rules, first));
      const seq = makeRng(2000 + i);
      for (let ply = 0; ply < 3; ply++) {
        const moves = legalMoves(b);
        const m = moves[Math.floor(seq() * moves.length)];
        a.place(m.card, m.cell);
        b.place(m.card, m.cell);
      }
      expect(negamax(a, -99, 99)).toBe(negamax(b, -99, 99));
    }
  });
});
