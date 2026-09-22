import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, applyNpc, matchupFromDraft } from './appState';
import {
  deckEvalKind, makeScenarios, matchupKey, matchupProblems, positionAtLeast, positionValue, ruleVariants, runDeckTask, scenarioBudget, scenarioPosition,
  supersetApplicable, supersetPosition, type Matchup,
} from './deckEval';
import { toFastBoard, type Position } from './position';
import { makeRng, type Rng } from './rng';
import { bruteForce } from './search';
import type { CardDef, CardType, Player } from './types';

function randomCard(r: Rng, lo = 1, hi = 10, typed = false): CardDef {
  const v = () => lo + Math.floor(r() * (hi - lo + 1));
  return { sides: [v(), v(), v(), v()], type: (typed && r() < 0.6 ? 1 + Math.floor(r() * 2) : 0) as CardType };
}

const cards = (r: Rng, n: number, lo = 1, hi = 10, typed = false) => Array.from({ length: n }, () => randomCard(r, lo, hi, typed));

function matchup(r: Rng, over: Partial<Matchup> = {}): Matchup {
  return { ruleIds: [], options: { fallenAceInCombo: true }, oppKnown: cards(r, 3), oppPool: cards(r, 4), oppUnknown: 2, roulette: 0, swap: false, ...over };
}

const OPT = { maxScenarios: 40, maxHands: 30 };
const total = (xs: { weight: number }[]) => xs.reduce((a, x) => a + x.weight, 0);

/** 全探索で求めた、自分から見た値 */
function myValue(pos: Position): number {
  const b = toFastBoard(pos).board;
  const v = bruteForce(b);
  return b.turn === 0 ? v : -v;
}

describe('ルーレットの結果', () => {
  it('ルーレットが無ければ、結果は 1 通り', () => {
    const v = ruleVariants(matchup(makeRng(1), { ruleIds: [6] }));
    expect(v.length).toBe(1);
    expect(v[0]).toMatchObject({ swap: false, added: [[]], share: 1 });
    expect(v[0].rules.plus).toBe(true);
  });

  it('既に有効なルールと、それと排他のルールは選ばれない。盤面に関係しないルールは 1 つにまとまる', () => {
    const v = ruleVariants(matchup(makeRng(1), { ruleIds: [6, 8], roulette: 1 }));
    const added = v.flatMap((x) => x.added.map((a) => a[0])).sort((a, b) => a - b);
    // プラス(6)・オーダー(8)・カオス(9)は出ない
    expect(added).toEqual([2, 3, 4, 5, 10, 11, 12, 13, 14]);
    expect(v.find((x) => x.added.length === 3)!.added.map((a) => a[0]).sort()).toEqual([2, 3, 5]);
    expect(v.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
    expect(v.filter((x) => x.swap).length).toBe(1);
    expect(v.every((x) => x.rules.plus && x.rules.pick === 'order')).toBe(true);
  });

  it('ルーレットが 2 つの時は順不同の組になり、排他のルール同士は組にならない', () => {
    const v = ruleVariants(matchup(makeRng(1), { roulette: 2 }));
    const pairs = v.flatMap((x) => x.added);
    expect(pairs.every((p) => p.length === 2 && p[0] < p[1])).toBe(true);
    expect(new Set(pairs.map((p) => p.join())).size).toBe(pairs.length);
    for (const [a, b] of [[2, 3], [8, 9], [12, 13]]) expect(pairs.some((p) => p[0] === a && p[1] === b)).toBe(false);
    // 12 個から 2 個選ぶ 66 通りから、排他の 3 組を除く
    expect(pairs.length).toBe(63);
    expect(v.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
  });

  it('スワップを持つ NPC では、全ての結果がスワップつきになる', () => {
    expect(ruleVariants(matchup(makeRng(1), { swap: true, roulette: 1 })).every((x) => x.swap)).toBe(true);
  });
});

describe('シナリオの生成', () => {
  it('相手の手札 × 先攻/後攻 が上限以下なら全て並べ、重みの合計は 1', () => {
    const set = makeScenarios(matchup(makeRng(2)), { ...OPT, rng: makeRng(3) });
    expect(set.enumerated).toBe(true);
    expect(set.handCount).toBe(6);
    expect(set.scenarios.length).toBe(12);
    expect(total(set.scenarios)).toBeCloseTo(1);
    expect(set.scenarios.filter((s) => s.first === 0).length).toBe(6);
    expect(set.scenarios.every((s) => s.oppHand.length === 5 && s.swap === undefined && s.myOrder === undefined)).toBe(true);
  });

  it('手札が全て分かっていれば、先攻と後攻の 2 通りだけ', () => {
    const r = makeRng(4);
    const set = makeScenarios(matchup(r, { oppKnown: cards(r, 5), oppPool: [], oppUnknown: 0 }), { ...OPT, rng: makeRng(3) });
    expect(set.scenarios.map((s) => s.first)).toEqual([0, 1]);
  });

  it('スワップは 25 通りの交換に展開する。上限を超えたらサンプリングし、上限を上げれば全て並ぶ', () => {
    const m = matchup(makeRng(5), { swap: true });
    const sampled = makeScenarios(m, { ...OPT, rng: makeRng(3) });
    expect(sampled.enumerated).toBe(false);
    expect(sampled.scenarios.length).toBe(40);
    expect(sampled.scenarios.every((s) => s.swap !== undefined)).toBe(true);
    expect(sampled.scenarios.filter((s) => s.first === 0).length).toBe(20);
    expect(total(sampled.scenarios)).toBeCloseTo(1);
    const full = makeScenarios(m, { ...OPT, maxScenarios: 300, rng: makeRng(3) });
    expect(full.enumerated).toBe(true);
    expect(full.scenarios.length).toBe(6 * 2 * 25);
    expect(new Set(full.scenarios.map((s) => `${s.oppHand.map((c) => c.sides.join('')).join()}|${s.first}|${s.swap!.mine}${s.swap!.theirs}`)).size).toBe(300);
  });

  it('カオスは常にサンプリングで、出る順は双方とも手札の並べ替えになっている', () => {
    const m = matchup(makeRng(6), { ruleIds: [9] });
    const set = makeScenarios(m, { ...OPT, rng: makeRng(3) });
    expect(set.enumerated).toBe(false);
    expect(deckEvalKind(m, set)).toBe('chaos');
    for (const s of set.scenarios) {
      expect([...s.myOrder!].sort()).toEqual([0, 1, 2, 3, 4]);
      expect(m.oppKnown.every((c) => s.oppHand.includes(c))).toBe(true);
      expect(s.oppHand.filter((c) => m.oppPool.includes(c)).length).toBe(2);
    }
    expect(new Set(set.scenarios.map((s) => s.myOrder!.join(''))).size).toBeGreaterThan(10);
  });

  it('オーダーでは相手の並び順もシナリオに展開する。数が収まれば 120 通りを全て並べる', () => {
    const r = makeRng(23);
    const m = matchup(r, { ruleIds: [8], oppKnown: cards(r, 5), oppPool: [], oppUnknown: 0 });
    const sampled = makeScenarios(m, { ...OPT, rng: makeRng(3) });
    expect(sampled.enumerated).toBe(false);
    expect(sampled.scenarios.every((s) => s.myOrder === undefined && [...s.oppHand].sort().join() === [...m.oppKnown].sort().join())).toBe(true);
    const full = makeScenarios(m, { ...OPT, maxScenarios: 240, rng: makeRng(3) });
    expect(full.enumerated).toBe(true);
    expect(new Set(full.scenarios.map((s) => `${s.first}|${s.oppHand.map((c) => m.oppKnown.indexOf(c)).join('')}`)).size).toBe(240);
    expect(total(full.scenarios)).toBeCloseTo(1);
  });

  it('シナリオ数の目安: 出すカードが決まっているルール(オーダー/カオス)は探索が軽いので多く取る', () => {
    const r = makeRng(24);
    expect(scenarioBudget(matchup(r)).search).toBeLessThan(scenarioBudget(matchup(r, { ruleIds: [8] })).search);
    expect(scenarioBudget(matchup(r, { ruleIds: [9] })).search).toBe(scenarioBudget(matchup(r, { ruleIds: [8] })).search);
    // ルーレットで自由に出せるルールが混ざるなら、重い方に合わせる
    expect(scenarioBudget(matchup(r, { roulette: 1 })).search).toBe(scenarioBudget(matchup(r)).search);
  });

  it('ルーレットでは、結果ごとに確率に応じた数のシナリオを割り当てる', () => {
    const set = makeScenarios(matchup(makeRng(7), { roulette: 1 }), { ...OPT, rng: makeRng(3) });
    expect(total(set.scenarios)).toBeCloseTo(1);
    set.variants.forEach((v, vi) => {
      const mine = set.scenarios.filter((s) => s.variant === vi);
      expect(mine.length).toBeGreaterThanOrEqual(2);
      expect(total(mine)).toBeCloseTo(v.share);
      expect(Math.abs(mine.filter((s) => s.first === 0).length - mine.length / 2)).toBeLessThanOrEqual(0.5);
    });
  });

  it('同じシードなら同じシナリオになり、デッキには依らない', () => {
    const m = matchup(makeRng(8), { swap: true, roulette: 1 });
    expect(makeScenarios(m, { ...OPT, rng: makeRng(9) })).toEqual(makeScenarios(m, { ...OPT, rng: makeRng(9) }));
    expect(matchupKey(m)).toBe(matchupKey({ ...m }));
    expect(matchupKey(m)).not.toBe(matchupKey({ ...m, swap: false }));
  });

  it('相手の候補が足りなければ、シナリオを作らない', () => {
    const m = matchup(makeRng(10), { oppPool: cards(makeRng(11), 1) });
    expect(matchupProblems(m)).toEqual(['oppUnknown']);
    expect(makeScenarios(m, { ...OPT, rng: makeRng(3) }).scenarios).toEqual([]);
  });

  it('結果の種類: 手札が裏向きなら目安、オールオープンか全て既知なら確定', () => {
    const r = makeRng(12);
    const hidden = matchup(r);
    expect(deckEvalKind(hidden, makeScenarios(hidden, { ...OPT, rng: makeRng(3) }))).toBe('estimate');
    const open = matchup(r, { ruleIds: [2] });
    expect(deckEvalKind(open, makeScenarios(open, { ...OPT, rng: makeRng(3) }))).toBe('exact');
    const known = matchup(r, { oppKnown: cards(r, 5), oppPool: [], oppUnknown: 0 });
    expect(deckEvalKind(known, makeScenarios(known, { ...OPT, rng: makeRng(3) }))).toBe('exact');
    // ルーレットでカオスが出うる時は、オールオープンでも出る順までは見えない
    const roulette = matchup(r, { ruleIds: [2], roulette: 1 });
    expect(deckEvalKind(roulette, makeScenarios(roulette, { ...OPT, rng: makeRng(3) }))).toBe('estimate');
  });
});

describe('シナリオの局面', () => {
  it('デッキは cards[0..4] に入り、スワップは同じスロット同士で交換する', () => {
    const r = makeRng(13);
    const m = matchup(r, { swap: true, ruleIds: [8] });
    const set = makeScenarios(m, { ...OPT, rng: makeRng(3) });
    const deck = cards(r, 5);
    for (const s of set.scenarios) {
      const pos = scenarioPosition(m, set, s, deck);
      const { mine, theirs } = s.swap!;
      expect(pos.cards[mine]).toBe(s.oppHand[theirs]);
      expect(pos.cards[5 + theirs]).toBe(deck[mine]);
      expect(pos.cards.filter((_, i) => i < 5 && i !== mine)).toEqual(deck.filter((_, i) => i !== mine));
      expect(pos).toMatchObject({ myHand: [0, 1, 2, 3, 4], oppKnown: [5, 6, 7, 8, 9], oppUnknown: 0, turn: s.first, first: s.first, oppOrderKnown: true });
      expect(pos.rules.pick).toBe('order');
    }
  });

  it('カオスのシナリオは、双方の出る順が決まったオーダーの対局になる', () => {
    const r = makeRng(14);
    const m = matchup(r, { ruleIds: [9] });
    const set = makeScenarios(m, { ...OPT, rng: makeRng(3) });
    const pos = scenarioPosition(m, set, set.scenarios[0], cards(r, 5));
    expect(pos.rules.pick).toBe('order');
    expect(pos.oppOrderKnown).toBe(true);
    expect(pos.myHand).toEqual(set.scenarios[0].myOrder);
    const b = toFastBoard(pos).board;
    expect(b.orderMe && b.orderOpp).toBe(true);
  });
});

describe('positionAtLeast / positionValue', () => {
  it('双方の出る順が決まった対局では、空の盤面からの全探索と一致する(セイム/プラス/タイプ補正を含む)', () => {
    const r = makeRng(15);
    for (let i = 0; i < 6; i++) {
      const m = matchup(r, { ruleIds: [9, ...(i % 2 ? [4, 6] : [11]), ...(i % 3 === 0 ? [12] : [])], oppKnown: cards(r, 3, 1, 10, true), oppPool: cards(r, 4, 1, 10, true) });
      const set = makeScenarios(m, { maxScenarios: 2, maxHands: 30, rng: makeRng(i) });
      const deck = cards(r, 5, 1, 10, true);
      for (const s of set.scenarios) {
        const pos = scenarioPosition(m, set, s, deck);
        const v = myValue(pos);
        for (const t of [1, 0]) expect(positionAtLeast(pos, t), `#${i} first=${s.first} t=${t}`).toBe(v >= t);
        expect(positionValue(pos), `#${i} first=${s.first}`).toBe(Math.min(1, v));
      }
    }
  });

  it('途中の局面でも、どちらの手番でも全探索と一致する', () => {
    const r = makeRng(16);
    for (let i = 0; i < 120; i++) {
      const all = cards(r, 10, 1, 10, true);
      const first = (r() < 0.5 ? 0 : 1) as Player;
      const placed = 4 + Math.floor(r() * 2);
      const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8].sort(() => r() - 0.5).slice(0, placed);
      const board: Position['board'] = Array(9).fill(null);
      const used = [0, 0];
      cells.forEach((cell, k) => {
        const who = ((first + k) % 2) as Player;
        board[cell] = { card: who * 5 + used[who]++, owner: (r() < 0.5 ? 0 : 1) as Player };
      });
      const pos: Position = {
        cards: all, board, myHand: [0, 1, 2, 3, 4].slice(used[0]), oppKnown: [5, 6, 7, 8, 9].slice(used[1]), oppPool: [], oppUnknown: 0,
        turn: ((first + placed) % 2) as Player, first,
        rules: { same: r() < 0.5, plus: r() < 0.5, reverse: r() < 0.3, fallenAce: r() < 0.3, typeShift: 'none', pick: 'free', open: 'all', suddenDeath: false },
        options: { fallenAceInCombo: true }, oppOrderKnown: false,
      };
      const v = myValue(pos);
      for (const t of [1, 0]) expect(positionAtLeast(pos, t), `#${i} t=${t}`).toBe(v >= t);
      expect(positionValue(pos), `#${i}`).toBe(Math.min(1, v));
    }
  });
});

describe('上位集合の保証', () => {
  it('上位集合で成り立つ結果は、相手のどの具体的な手札に対しても成り立つ', () => {
    const r = makeRng(17);
    let guaranteed = 0;
    for (let i = 0; i < 6; i++) {
      // オーダーにして探索を軽くする。強いデッキ・弱い相手を混ぜて、保証が出る場合を含める
      const weakOpp = i % 2 === 0;
      const m = matchup(r, { ruleIds: [8], oppKnown: cards(r, 2, 1, weakOpp ? 5 : 10), oppPool: cards(r, 4, 1, weakOpp ? 5 : 10), oppUnknown: 3 });
      expect(supersetApplicable(m)).toBe(true);
      const set = makeScenarios(m, { ...OPT, rng: makeRng(3) });
      const deck = cards(r, 5, weakOpp ? 6 : 1, 10);
      for (const first of [0, 1] as const) {
        for (const t of [1, 0]) {
          if (!positionAtLeast(supersetPosition(m, deck, first), t)) continue;
          guaranteed++;
          for (const s of set.scenarios.filter((x) => x.first === first)) {
            expect(positionAtLeast(scenarioPosition(m, set, s, deck), t), `#${i} first=${first} t=${t}`).toBe(true);
          }
        }
      }
    }
    expect(guaranteed).toBeGreaterThan(2);
  }, 60_000);

  it('ルーレット・スワップ・カオス・手札が全て既知の時は、上位集合を使わない', () => {
    const r = makeRng(18);
    expect(supersetApplicable(matchup(r, { roulette: 1 }))).toBe(false);
    expect(supersetApplicable(matchup(r, { swap: true }))).toBe(false);
    expect(supersetApplicable(matchup(r, { ruleIds: [9] }))).toBe(false);
    expect(supersetApplicable(matchup(r, { oppKnown: cards(r, 5), oppPool: [], oppUnknown: 0 }))).toBe(false);
  });
});

describe('runDeckTask', () => {
  it('シナリオのタスクは、そのシナリオの局面の勝ちの探り/保証値を返す', () => {
    const r = makeRng(19);
    const m = matchup(r, { ruleIds: [8] });
    const set = makeScenarios(m, { ...OPT, rng: makeRng(3) });
    const deck = cards(r, 5);
    const ctx = { matchup: m, set, refineSet: null };
    set.scenarios.slice(0, 10).forEach((s, i) => {
      const pos = scenarioPosition(m, set, s, deck);
      const base = { id: `t${i}`, kind: 'scenario', deckKey: 'k', set: 'search', scenario: i } as const;
      expect(runDeckTask(ctx, { ...base, deck, mode: 'value' })).toEqual({ ...base, mode: 'value', value: positionValue(pos) });
      expect(runDeckTask(ctx, { ...base, deck, mode: 'win' })).toEqual({ ...base, mode: 'win', ok: positionValue(pos) >= 1 });
      expect(runDeckTask(ctx, { ...base, deck, mode: 'draw' })).toEqual({ ...base, mode: 'draw', ok: positionValue(pos) >= 0 });
    });
  });

  it('測り直しのタスクは、測り直し用のシナリオを使う', () => {
    const r = makeRng(22);
    const m = matchup(r, { ruleIds: [8], swap: true });
    const set = makeScenarios(m, { ...OPT, maxScenarios: 4, rng: makeRng(3) });
    const refineSet = makeScenarios(m, { ...OPT, maxScenarios: 8, rng: makeRng(4) });
    const deck = cards(r, 5);
    const res = runDeckTask({ matchup: m, set, refineSet }, { id: 't', kind: 'scenario', deckKey: 'k', deck, set: 'refine', scenario: 7, mode: 'value' });
    expect(res).toMatchObject({ mode: 'value', value: positionValue(scenarioPosition(m, refineSet, refineSet.scenarios[7], deck)) });
  });
});

describe('matchupFromDraft', () => {
  const c = cards(makeRng(20), 9);

  it('NPC を選んだ下書き: 固定カードが既知、可変カードが候補。ルーレットとスワップは NPC のルールから数える', () => {
    const draft = applyNpc(EMPTY_DRAFT, { id: 1, fixed: c.slice(0, 3), variable: c.slice(3, 7), rules: [1, 1, 6, 14] }, []);
    const m = matchupFromDraft(draft, [1, 1, 6, 14]);
    expect(m).toMatchObject({ ruleIds: [6], oppKnown: c.slice(0, 3), oppPool: c.slice(3, 7), oppUnknown: 2, roulette: 2, swap: true });
    expect(matchupProblems(m)).toEqual([]);
  });

  it('相手の 5 枚を手で入れた下書き: 不明スロットなし', () => {
    const m = matchupFromDraft({ ...EMPTY_DRAFT, oppCards: c.slice(0, 5) }, []);
    expect(m).toMatchObject({ oppUnknown: 0, roulette: 0, swap: false });
    expect(matchupProblems(m)).toEqual([]);
  });

  it('相手が分からない下書き: 候補が足りない分は想定(oppPrior)で埋めるので評価できる。想定が無ければ評価できない', () => {
    const m = matchupFromDraft(EMPTY_DRAFT, []);
    expect(m.oppPrior).toEqual({ kind: 'level', level: 2 });
    expect(matchupProblems(m)).toEqual([]);
    expect(matchupProblems({ ...m, oppPrior: undefined })).toEqual(['oppUnknown']);
  });
});

describe('想定から引いた手札のシナリオ', () => {
  const fill = (r: Rng, _known: readonly CardDef[], count: number) => cards(r, count);

  it('候補が無くても想定があればシナリオが並び、結果は推定で、保証(上位集合)は調べない。同じシードなら同じシナリオ', () => {
    // オールオープンでも「相手のデッキがその分布から来る」仮定の上なので推定
    const m = matchup(makeRng(1), { ruleIds: [2], oppKnown: [], oppPool: [], oppUnknown: 5, oppPrior: { kind: 'meta' } });
    const set = makeScenarios(m, { ...OPT, rng: makeRng(1), fill });
    expect(set.scenarios.length).toBeGreaterThan(0);
    expect(set.scenarios.every((sc) => sc.oppHand.length === 5)).toBe(true);
    expect(set.handCount).toBe(0);
    expect(deckEvalKind(m, set)).toBe('estimate');
    expect(supersetApplicable(m)).toBe(false);
    expect(makeScenarios(m, { ...OPT, rng: makeRng(1), fill })).toEqual(set);
    expect(() => makeScenarios(m, { ...OPT, rng: makeRng(1) })).toThrow();
  });

  it('候補が一部あれば候補を先に使い、足りない分だけ想定から引く', () => {
    const known = cards(makeRng(2), 1);
    const poolCards = cards(makeRng(3), 2);
    const m = matchup(makeRng(1), { oppKnown: known, oppPool: poolCards, oppUnknown: 4, oppPrior: { kind: 'level', level: 3 } });
    const set = makeScenarios(m, { ...OPT, rng: makeRng(1), fill });
    for (const sc of set.scenarios) {
      expect(sc.oppHand.slice(0, 1)).toEqual(known);
      expect(sc.oppHand.length).toBe(5);
      expect(poolCards.every((c) => sc.oppHand.includes(c))).toBe(true);
    }
  });
});
