import type { DeckCard } from './collection';
import type { Matchup } from './deckEval';
import { cardPotential, cardScore } from './deckPool';

/**
 * オフィシャルトーナメントのドラフト。ゲームは「ランダムに構成された 3 つのセットから好きなセットを選ぶ」を 3 回行い、
 * 2 枚 + 2 枚 + 1 枚で 5 枚のデッキを組む(5.4 パッチノート)。ここでは提示されたセットを、想定した相手(m.oppRef)に対する
 * 静的な点で並べる。探索はしないので即座に出る。最終ラウンドの 3 通りのデッキは、別に読み切って比べられる(DraftPanel)
 */

/** 各ラウンドのセットの枚数 */
export const DRAFT_ROUNDS: readonly number[] = [2, 2, 1];
/** 1 ラウンドに提示されるセットの数 */
export const DRAFT_SETS = 3;

/** 手札の埋まり具合から今のラウンド(0〜2)。5 枚揃っていれば DRAFT_ROUNDS.length */
export function draftRound(filled: number): number {
  let n = 0;
  for (let r = 0; r < DRAFT_ROUNDS.length; r++) {
    if (filled < n + DRAFT_ROUNDS[r]) return r;
    n += DRAFT_ROUNDS[r];
  }
  return DRAFT_ROUNDS.length;
}

export interface DraftSetScore {
  index: number;
  score: number;
}

/**
 * 提示されたセットを高い順に。点 = カードごとの静的な点(cardScore)+ セイム/プラスで噛み合う見込み(cardPotential)の半分。
 * 同点は添字の小さい方(決定的)
 */
export function rankDraftSets(sets: readonly (readonly DeckCard[])[], m: Matchup): DraftSetScore[] {
  return sets
    .map((set, index) => ({ index, score: set.reduce((a, c) => a + cardScore(c, m) + 0.5 * cardPotential(c, m), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
