import { describe, expect, it } from 'vitest';
import { FastBoard, type FastSetup } from './fastEngine';
import { emptyState, placeRef, scoreRef } from './refEngine';
import { makeRng } from './rng';
import { toRuleBits, typeSign } from './rules';
import type { CardDef, CardType, EngineOptions, Player, RuleSet } from './types';

// 一様乱数ではセイム/プラス/同値/エースキラー/クランプがほとんど起きないので、偏った小さい集合から引く
const ALPHABETS = [
  [1, 2, 3, 9, 10],
  [1, 10],
  [4, 5, 6],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [8, 9, 10],
];

function randomCase(r: () => number) {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const alpha = pick(ALPHABETS);
  const typed = r() < 0.6;
  const cards: CardDef[] = [];
  for (let i = 0; i < 10; i++) {
    const type = (typed && r() < 0.7 ? 1 + Math.floor(r() * 2) : 0) as CardType;
    cards.push({ sides: [pick(alpha), pick(alpha), pick(alpha), pick(alpha)], type });
  }
  const rules: RuleSet = {
    same: r() < 0.5,
    plus: r() < 0.5,
    reverse: r() < 0.35,
    fallenAce: r() < 0.4,
    typeShift: typed ? pick(['asc', 'desc', 'none'] as const) : 'none',
    pick: 'free',
    open: 'all',
    suddenDeath: false,
  };
  const options: EngineOptions = { fallenAceInCombo: r() < 0.5 };
  const first = (r() < 0.5 ? 0 : 1) as Player;
  return { cards, rules, options, first };
}

describe('高速エンジンと参照エンジンの一致', () => {
  it('ランダムな対局で、毎手後の所有とタイプ枚数が一致し、undo で完全に戻る', () => {
    const r = makeRng(20260919);
    let sawCombo = 0;
    let sawSpecial = 0;
    let games = 0;
    for (let game = 0; game < 3000; game++) {
      const { cards, rules, options, first } = randomCase(r);
      const setup: FastSetup = {
        cards,
        myHand: [0, 1, 2, 3, 4],
        oppKnown: [5, 6, 7, 8, 9],
        oppPool: [],
        poolQuota: 0,
        board: Array(9).fill(null),
        turn: first,
        first,
        ruleBits: toRuleBits(rules, options),
        sign: typeSign(rules),
        orderMe: false,
        orderOpp: false,
      };
      const fast = new FastBoard(setup);
      let ref = emptyState(cards, rules, options);
      const initial = fast.snapshot();
      const history: [number, number, number][] = [];
      const hands = [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]];
      const empty = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      let turn: Player = first;

      for (let ply = 0; ply < 9; ply++) {
        const hand = hands[turn];
        const card = hand.splice(Math.floor(r() * hand.length), 1)[0];
        const cell = empty.splice(Math.floor(r() * empty.length), 1)[0];

        const before = countOwned(fast, turn);
        const flips = fast.place(card, cell);
        history.push([card, cell, flips]);
        const res = placeRef(ref, turn, card, cell);
        ref = res.state;

        // expect を毎回呼ぶと数十万回になって遅いので、素の比較で不一致を検出して詳細付きで落とす
        const refFlipMask = res.flips.reduce((m, f) => m | (1 << f.cell), 0);
        const where = `game ${game} ply ${ply} card ${card} cell ${cell} rules ${JSON.stringify(rules)}`;
        if (flips !== refFlipMask) throw new Error(`flip mask ${flips} != ref ${refFlipMask}: ${where}`);
        for (let c = 0; c < 9; c++) {
          const rc = ref.board[c];
          if (fast.cellCard[c] !== (rc ? rc.card : -1)) throw new Error(`cellCard[${c}] differs: ${where}`);
          if (rc && ((fast.own >>> c) & 1) !== rc.owner) throw new Error(`owner[${c}] differs: ${where}`);
        }
        if (Array.from(fast.tcount).join() !== ref.typeCount.join()) throw new Error(`typeCount differs: ${where}`);
        // 手番側の枚数は「裏返した数 + 置いた 1 枚」だけ増える
        if (countOwned(fast, turn) !== before + popcount(flips) + 1) throw new Error(`owned count wrong: ${where}`);
        if (res.flips.some((f) => f.cause === 'combo')) sawCombo++;
        if (res.flips.some((f) => f.cause === 'same' || f.cause === 'plus')) sawSpecial++;
        turn = (turn ^ 1) as Player;
      }

      const score = scoreRef(ref, first);
      if (fast.myCount() !== score.me || score.me + score.opp !== 10) throw new Error(`score differs in game ${game}`);

      for (let i = history.length - 1; i >= 0; i--) fast.undo(history[i][0], history[i][1], history[i][2]);
      if (fast.snapshot() !== initial) throw new Error(`undo did not restore the initial state in game ${game}`);
      games++;
    }
    expect(games).toBe(3000);
    // テストが実際にセイム/プラス/コンボを踏んでいることの確認
    expect(sawSpecial).toBeGreaterThan(500);
    expect(sawCombo).toBeGreaterThan(100);
  });

  it('プールのカードは残り枠までしか出せない', () => {
    const card: CardDef = { sides: [1, 1, 1, 1], type: 0 };
    const b = new FastBoard({
      cards: Array(8).fill(card),
      myHand: [0, 1],
      oppKnown: [2],
      oppPool: [3, 4, 5],
      poolQuota: 1,
      board: Array(9).fill(null),
      turn: 1,
      first: 1,
      ruleBits: 0,
      sign: 0,
      orderMe: false,
      orderOpp: false,
    });
    expect(b.playable()).toBe(0b111100);
    const f = b.place(3, 0);
    expect(b.poolLeft).toBe(0);
    b.place(0, 1);
    expect(b.playable()).toBe(0b000100); // 残り枠 0 なので既知カードだけ
    b.undo(0, 1, 0);
    b.undo(3, 0, f);
    expect(b.poolLeft).toBe(1);
    expect(b.playable()).toBe(0b111100);
  });

  it('オーダーでは先頭の未使用カードだけが出せる', () => {
    const card: CardDef = { sides: [1, 1, 1, 1], type: 0 };
    const b = new FastBoard({
      cards: Array(10).fill(card),
      myHand: [0, 1, 2, 3, 4],
      oppKnown: [5, 6, 7, 8, 9],
      oppPool: [],
      poolQuota: 0,
      board: Array(9).fill(null),
      turn: 0,
      first: 0,
      ruleBits: 0,
      sign: 0,
      orderMe: true,
      orderOpp: true,
    });
    expect(b.playable()).toBe(1 << 0);
    b.place(0, 0);
    expect(b.playable()).toBe(1 << 5);
    b.place(5, 1);
    expect(b.playable()).toBe(1 << 1);
  });
});

function popcount(x: number): number {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
}

function countOwned(b: FastBoard, p: Player): number {
  return popcount(p === 1 ? b.own : b.occ & ~b.own);
}
