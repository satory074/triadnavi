import { describe, expect, it } from 'vitest';
import { isLegalDeck, type DeckCard } from './collection';
import { makeHandSampler, priorKey, type HandPrior } from './handPrior';
import { makeRng, type Rng } from './rng';
import { NO_RULES, type CardType } from './types';

/** レアリティごとに n 枚の合成カード(ID は 1 から連番) */
function pool(r: Rng, perStar = 15): DeckCard[] {
  const out: DeckCard[] = [];
  for (let stars = 1; stars <= 5; stars++) {
    for (let i = 0; i < perStar; i++) {
      const v = () => 1 + Math.floor(r() * 10);
      out.push({ id: out.length + 1, stars, sides: [v(), v(), v(), v()], type: (r() < 0.3 ? 1 : 0) as CardType });
    }
  }
  return out;
}

const sum = (c: DeckCard) => c.sides.reduce((a, b) => a + b, 0);
const stars = (cards: readonly DeckCard[]) => cards.map((c) => c.stars).sort((a, b) => a - b);

describe('相手の手札の想定', () => {
  const cards = pool(makeRng(1));

  it('大会の相手(meta): 引いた手札は必ずデッキの制限内で、同じカードは 2 回引かない。同じシードなら同じ結果', () => {
    const sample = makeHandSampler({ kind: 'meta' }, cards, NO_RULES);
    const r = makeRng(2);
    for (let i = 0; i < 200; i++) {
      const hand = sample(r, [], 5);
      expect(hand.length).toBe(5);
      expect(isLegalDeck(hand)).toBe(true);
      expect(new Set(hand.map((c) => c.id)).size).toBe(5);
    }
    expect(sample(makeRng(3), [], 5)).toEqual(sample(makeRng(3), [], 5));
  });

  it('大会の相手(meta): 既知の手札に ★5 と ★4 があれば、残りに ★4 以上は入らず、既知のカードも引かない', () => {
    const sample = makeHandSampler({ kind: 'meta' }, cards, NO_RULES);
    const known = [cards.find((c) => c.stars === 5)!, cards.find((c) => c.stars === 4)!];
    const r = makeRng(4);
    for (let i = 0; i < 100; i++) {
      const rest = sample(r, known, 3);
      expect(rest.length).toBe(3);
      expect(rest.every((c) => c.stars <= 3)).toBe(true);
      expect(isLegalDeck([...known, ...rest])).toBe(true);
    }
  });

  it('ドラフトの相手(draft): ★1〜★5 が 1 枚ずつ。既知の手札のレアリティは引かない', () => {
    const sample = makeHandSampler({ kind: 'draft' }, cards, NO_RULES);
    const r = makeRng(5);
    for (let i = 0; i < 100; i++) expect(stars(sample(r, [], 5))).toEqual([1, 2, 3, 4, 5]);
    const known = [cards.find((c) => c.stars === 3)!];
    for (let i = 0; i < 50; i++) expect(stars(sample(r, known, 4))).toEqual([1, 2, 4, 5]);
  });

  it('強さはルールを見る: リバースでは小さい数字のカードが選ばれる', () => {
    const mean = (prior: HandPrior, reverse: boolean) => {
      const sample = makeHandSampler(prior, cards, { ...NO_RULES, reverse });
      const r = makeRng(6);
      let total = 0;
      for (let i = 0; i < 100; i++) total += sample(r, [], 5).reduce((a, c) => a + sum(c), 0);
      return total / 500;
    };
    for (const prior of [{ kind: 'meta' }, { kind: 'draft' }] as const) expect(mean(prior, true)).toBeLessThan(mean(prior, false));
  });

  it('3 段階の想定(level): 強い想定ほど平均の辺の値が大きい。想定の種類はキーで区別できる', () => {
    const mean = (level: 1 | 2 | 3) => {
      const sample = makeHandSampler({ kind: 'level', level }, cards, NO_RULES);
      const r = makeRng(level);
      let total = 0;
      for (let i = 0; i < 400; i++) total += sample(r, [], 5).reduce((a, c) => a + c.stars, 0);
      return total / 2000;
    };
    expect(mean(1)).toBeLessThan(mean(2));
    expect(mean(2)).toBeLessThan(mean(3));
    expect(new Set([priorKey({ kind: 'level', level: 1 }), priorKey({ kind: 'level', level: 3 }), priorKey({ kind: 'meta' }), priorKey({ kind: 'draft' })]).size).toBe(4);
  });
});
