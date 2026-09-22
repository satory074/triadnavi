import { describe, expect, it } from 'vitest';
import type { DeckCard } from './collection';
import type { Matchup } from './deckEval';
import { DRAFT_ROUNDS, draftRound, rankDraftSets } from './draftPick';
import type { CardType, Sides } from './types';

const card = (id: number, sides: number[], stars = 3): DeckCard => ({ id, stars, sides: sides as unknown as Sides, type: 0 as CardType });
const matchup = (ruleIds: number[]): Matchup => ({ ruleIds, options: { fallenAceInCombo: true }, oppKnown: [], oppPool: [], oppUnknown: 5, roulette: 0, swap: false, oppPrior: { kind: 'draft' } });

describe('ドラフトのセット選び', () => {
  const strong = [card(1, [9, 10, 9, 10]), card(2, [8, 9, 9, 8])];
  const weak = [card(3, [1, 2, 1, 2]), card(4, [2, 1, 2, 1])];
  const mid = [card(5, [5, 5, 5, 5]), card(6, [6, 4, 6, 4])];

  it('全ての辺が上回るセットが上位。リバースでは逆になる。同じ入力なら同じ順', () => {
    const base = rankDraftSets([weak, strong, mid], matchup([]));
    expect(base.map((s) => s.index)).toEqual([1, 2, 0]);
    expect(rankDraftSets([weak, strong, mid], matchup([]))).toEqual(base);
    const reverse = rankDraftSets([weak, strong, mid], matchup([10]));
    expect(reverse[0].index).toBe(0);
    expect(reverse[2].index).toBe(1);
  });

  it('ラウンドは手札の埋まり具合から決まる(2 枚 + 2 枚 + 1 枚)', () => {
    expect(DRAFT_ROUNDS.reduce((a, b) => a + b, 0)).toBe(5);
    expect([0, 1, 2, 3, 4, 5].map(draftRound)).toEqual([0, 0, 1, 1, 2, 3]);
  });
});
