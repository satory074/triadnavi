import type { EngineOptions, RuleSet } from './types';
import { NO_RULES } from './types';

/** ゲームデータ TripleTriadRule の行 ID */
export const RULE_ID = {
  roulette: 1,
  allOpen: 2,
  threeOpen: 3,
  same: 4,
  suddenDeath: 5,
  plus: 6,
  random: 7,
  order: 8,
  chaos: 9,
  reverse: 10,
  fallenAce: 11,
  ascension: 12,
  descension: 13,
  swap: 14,
  draft: 15,
} as const;

export const RULE_NAMES: Readonly<Record<number, string>> = {
  1: 'ルーレット',
  2: 'オールオープン',
  3: 'スリーオープン',
  4: 'セイム',
  5: 'サドンデス',
  6: 'プラス',
  7: 'ランダムハンド',
  8: 'オーダー',
  9: 'カオス',
  10: 'リバース',
  11: 'エースキラー',
  12: 'タイプアセンド',
  13: 'タイプディセンド',
  14: 'スワップ',
  15: 'ドラフト',
};

/** 対戦開始前に解決され、エンジンの挙動を変えないルール(実際の手札とルールを入力してもらう) */
export const PRE_MATCH_RULE_IDS: readonly number[] = [1, 7, 14, 15];

/**
 * ルール ID の一覧から RuleSet を作る。公式に排他と明記された 3 組
 * (オールオープン/スリーオープン、オーダー/カオス、タイプアセンド/タイプディセンド)は後勝ち。
 */
export function rulesFromIds(ids: readonly number[]): RuleSet {
  const r: RuleSet = { ...NO_RULES };
  for (const id of ids) {
    switch (id) {
      case RULE_ID.allOpen: r.open = 'all'; break;
      case RULE_ID.threeOpen: r.open = 'three'; break;
      case RULE_ID.same: r.same = true; break;
      case RULE_ID.suddenDeath: r.suddenDeath = true; break;
      case RULE_ID.plus: r.plus = true; break;
      case RULE_ID.order: r.pick = 'order'; break;
      case RULE_ID.chaos: r.pick = 'chaos'; break;
      case RULE_ID.reverse: r.reverse = true; break;
      case RULE_ID.fallenAce: r.fallenAce = true; break;
      case RULE_ID.ascension: r.typeShift = 'asc'; break;
      case RULE_ID.descension: r.typeShift = 'desc'; break;
      default: break;
    }
  }
  return r;
}

export function ruleIdsOf(r: RuleSet): number[] {
  const ids: number[] = [];
  if (r.open === 'all') ids.push(RULE_ID.allOpen);
  if (r.open === 'three') ids.push(RULE_ID.threeOpen);
  if (r.same) ids.push(RULE_ID.same);
  if (r.plus) ids.push(RULE_ID.plus);
  if (r.reverse) ids.push(RULE_ID.reverse);
  if (r.fallenAce) ids.push(RULE_ID.fallenAce);
  if (r.typeShift === 'asc') ids.push(RULE_ID.ascension);
  if (r.typeShift === 'desc') ids.push(RULE_ID.descension);
  if (r.pick === 'order') ids.push(RULE_ID.order);
  if (r.pick === 'chaos') ids.push(RULE_ID.chaos);
  if (r.suddenDeath) ids.push(RULE_ID.suddenDeath);
  return ids;
}

/** 高速エンジン用のビット */
export const BIT_SAME = 1;
export const BIT_PLUS = 2;
export const BIT_REVERSE = 4;
export const BIT_FALLEN_ACE = 8;
export const BIT_FALLEN_ACE_COMBO = 16;

export function toRuleBits(r: RuleSet, o: EngineOptions): number {
  let b = 0;
  if (r.same) b |= BIT_SAME;
  if (r.plus) b |= BIT_PLUS;
  if (r.reverse) b |= BIT_REVERSE;
  if (r.fallenAce) b |= BIT_FALLEN_ACE;
  if (r.fallenAce && o.fallenAceInCombo) b |= BIT_FALLEN_ACE_COMBO;
  return b;
}

/** タイプ補正の符号。アセンド +1、ディセンド -1、なし 0 */
export function typeSign(r: RuleSet): number {
  return r.typeShift === 'asc' ? 1 : r.typeShift === 'desc' ? -1 : 0;
}
