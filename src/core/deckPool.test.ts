import { describe, expect, it } from 'vitest';
import { isLegalDeck, type DeckCard } from './collection';
import type { Matchup } from './deckEval';
import { buildPools, cardScore, deckHeuristic, deckKey, neighbours, poolCards, seedDecks } from './deckPool';
import { FastBoard, type FastSetup } from './fastEngine';
import { makeRng, type Rng } from './rng';
import { toRuleBits } from './rules';
import { legalMoves, negamax } from './search';
import { NO_RULES, type CardDef, type CardType, type RuleSet, type Sides } from './types';

const card = (sides: number[], type: CardType = 0): CardDef => ({ sides: sides as unknown as Sides, type });

/** 実際のカードに近い分布の手持ち: ★が高いほど数字が大きい */
function collection(r: Rng, n: number): DeckCard[] {
  return Array.from({ length: n }, (_, i) => {
    const stars = 1 + Math.floor(r() * 5);
    const v = () => Math.max(1, Math.min(10, stars + 1 + Math.floor(r() * 5)));
    return { id: i + 1, stars, sides: [v(), v(), v(), v()] as unknown as Sides, type: (r() < 0.3 ? 1 + Math.floor(r() * 4) : 0) as CardType };
  });
}

function matchup(r: Rng, over: Partial<Matchup> = {}): Matchup {
  const v = () => 1 + Math.floor(r() * 10);
  const cards = (n: number) => Array.from({ length: n }, () => card([v(), v(), v(), v()]));
  return { ruleIds: [], options: { fallenAceInCombo: true }, oppKnown: cards(3), oppPool: cards(4), oppUnknown: 2, roulette: 0, swap: false, ...over };
}

describe('候補の絞り込み', () => {
  it('候補は手持ちだけから選ばれ、枠ごとの数に収まり、同じ入力なら同じ結果になる', () => {
    const r = makeRng(1);
    const owned = collection(r, 200);
    const m = matchup(r, { ruleIds: [4, 6] });
    const opt = { perFive: 8, perFour: 8, low: 15, special: 4 };
    const pools = buildPools(owned, m, opt);
    expect(pools.five.every((c) => c.stars === 5 && owned.includes(c))).toBe(true);
    expect(pools.four.every((c) => c.stars === 4 && owned.includes(c))).toBe(true);
    expect(pools.low.every((c) => c.stars <= 3 && owned.includes(c))).toBe(true);
    expect(pools.five.length).toBeLessThanOrEqual(12);
    expect(pools.low.length).toBeGreaterThanOrEqual(15);
    expect(pools.low.length).toBeLessThanOrEqual(19);
    expect(new Set(poolCards(pools).map((c) => c.id)).size).toBe(poolCards(pools).length);
    expect(Object.keys(pools.score).length).toBe(owned.length);
    expect(buildPools(owned, m, opt)).toEqual(pools);
  });

  it('全ての辺が同じか上回るカードは、基本ルールでは点数も同じか上回る(リバースでは逆)', () => {
    const r = makeRng(2);
    for (let i = 0; i < 300; i++) {
      const m = matchup(r);
      const v = () => 1 + Math.floor(r() * 10);
      const weak = card([v(), v(), v(), v()]);
      const strong = card(weak.sides.map((x) => Math.min(10, x + Math.floor(r() * 3))));
      expect(cardScore(strong, m)).toBeGreaterThanOrEqual(cardScore(weak, m) - 1e-12);
      expect(cardScore(strong, { ...m, ruleIds: [10] })).toBeLessThanOrEqual(cardScore(weak, { ...m, ruleIds: [10] }) + 1e-12);
    }
  });

  it('エースキラーでは、相手が 1 を持っていれば A の辺の評価が下がる', () => {
    const r = makeRng(3);
    const m = matchup(r, { oppKnown: [card([1, 1, 1, 1]), card([1, 1, 1, 1]), card([1, 1, 1, 1])], oppPool: [card([1, 1, 1, 1]), card([1, 1, 1, 1])] });
    expect(cardScore(card([10, 10, 10, 10]), { ...m, ruleIds: [11] })).toBeLessThan(cardScore(card([9, 9, 9, 9]), { ...m, ruleIds: [11] }));
    expect(cardScore(card([10, 10, 10, 10]), m)).toBeGreaterThanOrEqual(cardScore(card([9, 9, 9, 9]), m));
  });

  it('アセンドでは相手が使わないタイプのカードが上がり、ディセンドではタイプ持ちが下がる', () => {
    const r = makeRng(4);
    const m = matchup(r);
    const plain = card([7, 7, 7, 7]);
    const typed = card([7, 7, 7, 7], 2);
    expect(cardScore(typed, { ...m, ruleIds: [12] })).toBeGreaterThan(cardScore(plain, { ...m, ruleIds: [12] }));
    expect(cardScore(typed, { ...m, ruleIds: [13] })).toBeLessThan(cardScore(plain, { ...m, ruleIds: [13] }));
    expect(cardScore(typed, m)).toBe(cardScore(plain, m));
  });
});

describe('出発点のデッキ', () => {
  it('全て合法で手持ちだけからなり、同じ入力なら同じ結果。利用者のデッキも含まれる', () => {
    const r = makeRng(5);
    for (let i = 0; i < 30; i++) {
      const owned = collection(r, 20 + Math.floor(r() * 200));
      const m = matchup(r, { ruleIds: [[], [4, 6], [12], [13], [10], [8]][i % 6] });
      const pools = buildPools(owned, m);
      const mine = owned.filter((c) => c.stars <= 3).slice(0, 5);
      const seeds = seedDecks(pools, m, mine.length === 5 ? [mine] : []);
      expect(seeds.length).toBeGreaterThan(0);
      for (const d of seeds) {
        expect(isLegalDeck(d)).toBe(true);
        expect(d.every((c) => owned.includes(c))).toBe(true);
      }
      if (mine.length === 5) expect(seeds.some((d) => deckKey(d, true) === deckKey(mine, true))).toBe(true);
      expect(seedDecks(pools, m, mine.length === 5 ? [mine] : [])).toEqual(seeds);
    }
  });

  it('合法なデッキを組めるだけの手持ちが無ければ、出発点は無い', () => {
    const r = makeRng(6);
    const owned = collection(r, 50).filter((c) => c.stars === 5).slice(0, 6);
    expect(seedDecks(buildPools(owned, matchup(r)), matchup(r), [])).toEqual([]);
  });
});

describe('1 手先のデッキ', () => {
  it('どれも合法で、元のデッキと 1 枚だけ違い、同じものが 2 回出ない', () => {
    const r = makeRng(7);
    const owned = collection(r, 150);
    const m = matchup(r);
    const pools = buildPools(owned, m);
    const deck = seedDecks(pools, m, [])[0];
    const next = neighbours(deck, pools, false);
    expect(next.length).toBeGreaterThan(20);
    for (const d of next) {
      expect(isLegalDeck(d)).toBe(true);
      expect(d.filter((c, i) => c.id !== deck[i].id).length).toBe(1);
    }
    const keys = next.map((d) => deckKey(d, false));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(deckKey(deck, false));
  });

  it('並び順が関係する時は、位置の入れ替え 10 通りを先に出す', () => {
    const r = makeRng(8);
    const owned = collection(r, 150);
    const m = matchup(r, { ruleIds: [8] });
    const pools = buildPools(owned, m);
    const deck = seedDecks(pools, m, [])[0];
    const next = neighbours(deck, pools, true);
    for (const d of next.slice(0, 10)) expect([...d].sort((a, b) => a.id - b.id)).toEqual([...deck].sort((a, b) => a.id - b.id));
    expect(next.length).toBeGreaterThan(30);
  });

  it('キーは数字とタイプで決まり、並び順は指定した時だけ区別する', () => {
    const a = [card([1, 2, 3, 4]), card([5, 6, 7, 8], 1), card([2, 2, 2, 2]), card([3, 3, 3, 3]), card([4, 4, 4, 4])];
    const b = [a[1], a[0], a[2], a[3], a[4]];
    expect(deckKey(a, false)).toBe(deckKey(b, false));
    expect(deckKey(a, true)).not.toBe(deckKey(b, true));
    expect(deckKey(a, false)).not.toBe(deckKey([card([1, 2, 3, 4], 2), ...a.slice(1)], false));
  });

  it('静的な点はカードの点の合計', () => {
    const r = makeRng(9);
    const owned = collection(r, 60);
    const pools = buildPools(owned, matchup(r));
    const deck = owned.slice(0, 5);
    expect(deckHeuristic(deck, pools)).toBeCloseTo(deck.reduce((a, c) => a + pools.score[c.id], 0));
  });
});

describe('支配による絞り込みは健全ではない', () => {
  function board(cards: CardDef[], rules: RuleSet, first: 0 | 1): FastBoard {
    const setup: FastSetup = {
      cards, myHand: [0, 1, 2, 3, 4], oppKnown: [5, 6, 7, 8, 9], oppPool: [], poolQuota: 0, board: Array(9).fill(null),
      turn: first, first, ruleBits: toRuleBits(rules, { fallenAceInCombo: true }), sign: 0, orderMe: false, orderOpp: false,
    };
    return new FastBoard(setup);
  }
  const myValue = (b: FastBoard) => {
    const v = negamax(b, -99, 99);
    return b.turn === 0 ? v : -v;
  };

  it('基本ルールでも、全ての辺が同じか上回るカードに替えると保証値が下がる局面がある', () => {
    // 取られたカードは、相手のためにその高い数字で守る。弱いカードなら取り返せた所が、強いカードだと取り返せない
    const rest = [[6, 5, 6, 4], [4, 6, 5, 5], [6, 4, 5, 6], [6, 5, 5, 6], [6, 5, 5, 5], [6, 6, 6, 6], [4, 4, 6, 5], [6, 6, 4, 4], [6, 5, 6, 5]].map((s) => card(s));
    const values = [card([6, 4, 4, 4]), card([6, 5, 6, 6])].map((mine) => {
      const b = board([mine, ...rest], NO_RULES, 0);
      for (const [c, cell] of [[3, 0], [5, 4], [4, 2], [8, 1]]) b.place(c, cell);
      return myValue(b);
    });
    expect(values).toEqual([0, -1]);
  });

  it('セイム+プラスでは珍しくない(ランダムな局面の数 % で起きる)', () => {
    const r = makeRng(5);
    const rules = { ...NO_RULES, same: true, plus: true };
    let trials = 0;
    let worse = 0;
    for (let i = 0; i < 400; i++) {
      const v = () => 1 + Math.floor(r() * 10);
      const cards = Array.from({ length: 10 }, () => card([v(), v(), v(), v()]));
      const strong = card(cards[0].sides.map((x) => Math.min(10, x + Math.floor(r() * 3))));
      const first = (r() < 0.5 ? 0 : 1) as 0 | 1;
      const weakBoard = board(cards, rules, first);
      const strongBoard = board([strong, ...cards.slice(1)], rules, first);
      // 替えるカード(0 番)を手札に残したまま、両方の盤面を同じ手で 4 手進める
      for (let k = 0; k < 4; k++) {
        const moves = legalMoves(weakBoard).filter((m) => m.card !== 0);
        const m = moves[Math.floor(r() * moves.length)];
        weakBoard.place(m.card, m.cell);
        strongBoard.place(m.card, m.cell);
      }
      trials++;
      if (myValue(strongBoard) < myValue(weakBoard)) worse++;
    }
    expect(worse).toBeGreaterThan(0);
    expect(worse / trials).toBeLessThan(0.15);
  });
});
