import { MAX_FIVE_STAR, MAX_FOUR_PLUS, type DeckCard } from './collection';
import { staticStrength } from './deckPool';
import { hashSeed, makeRng, type Rng } from './rng';
import type { RuleSet } from './types';

/**
 * 相手の裏向きの手札の想定。候補リストが無い/足りない時に不明スロットを埋めるカードの引き方で、
 * 対局中の推定(worlds.ts)とデッキの評価(deckEval.ts)が同じ引き方を使う。どれも保証は出せない(結果は「推定」)。
 *   level  相手の強さを 3 段階で想定し、カードごとに独立にレアリティを引く(通常の対人戦)
 *   meta   大会の相手。デッキの制限内で強いカードを使うと想定する(★5 1 枚 + ★4 1 枚 + ★3 以下 3 枚。各段は強い順の上位から一様)
 *   draft  ドラフトの相手。★1〜★5 が 1 枚ずつで、各段は「3 枚から最も強い 1 枚を選んだ」と想定する
 * 「強さ」はルールを見た静的な点(deckPool の staticStrength。リバースなら小さい数字が強い)。
 */
export type PriorLevel = 1 | 2 | 3;
export type HandPrior = { kind: 'level'; level: PriorLevel } | { kind: 'meta' } | { kind: 'draft' };

/** 不明スロットを埋めるカードを count 枚引く。known は相手の既知の手札(同梱データに無いカードは stars 0)。同じ id は引かない */
export type HandSampler = (rng: Rng, known: readonly DeckCard[], count: number) => DeckCard[];

export function priorKey(p: HandPrior): string {
  return p.kind === 'level' ? `level${p.level}` : p.kind;
}

export const LEVEL_LABEL: Record<PriorLevel, string> = { 1: '弱め', 2: '標準', 3: '強い' };

/** 想定の短い説明(対局画面の見出しなど) */
export function priorLabel(p: HandPrior): string {
  if (p.kind === 'meta') return '強いデッキを想定';
  if (p.kind === 'draft') return 'ドラフトの手札を想定';
  return `${LEVEL_LABEL[p.level]}の相手を想定`;
}

/** level: ★1〜★5 の重み */
const LEVEL_WEIGHTS: Record<PriorLevel, readonly number[]> = {
  1: [4, 5, 3, 0.5, 0],
  2: [0.5, 2, 6, 1.5, 0.7],
  3: [0, 0.5, 5, 2.5, 2],
};

/** meta: 各段で候補にする強い順の枚数(deckPool の DEFAULT_POOL_OPTIONS と同じ数) */
export const META_TOP = { five: 10, four: 10, low: 20 } as const;
/** draft: 各段で何枚から最も強い 1 枚を選んだと見なすか(ゲームは 3 セットから選ぶ) */
export const DRAFT_CHOICES = 3;

const ANY = 0;
const LOW = 6;

export function makeHandSampler(prior: HandPrior, pool: readonly DeckCard[], rules: RuleSet): HandSampler {
  const strength = new Map(pool.map((c) => [c.id, staticStrength(c, rules)]));
  const byStrength = (a: DeckCard, b: DeckCard) => strength.get(b.id)! - strength.get(a.id)! || a.id - b.id;
  // 強い順に並べた段。tier[1..5] = ★1〜★5、tier[ANY] = 全て、tier[LOW] = ★3 以下
  const tier: DeckCard[][] = [];
  tier[ANY] = [...pool].sort(byStrength);
  for (let s = 1; s <= 5; s++) tier[s] = tier[ANY].filter((c) => c.stars === s);
  tier[LOW] = tier[ANY].filter((c) => c.stars <= 3);

  return (rng, known, count) => {
    const used = new Set(known.map((c) => c.id));
    const out: DeckCard[] = [];
    const take = (c: DeckCard) => {
      used.add(c.id);
      out.push(c);
    };
    const free = (t: number) => tier[t].filter((c) => !used.has(c.id));
    const uniform = (xs: readonly DeckCard[]) => xs[Math.floor(rng() * xs.length)];

    if (prior.kind === 'level') {
      const w = LEVEL_WEIGHTS[prior.level];
      const total = w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < count; i++) {
        let x = rng() * total;
        let s = 1;
        for (; s < 5; s++) {
          x -= w[s - 1];
          if (x < 0) break;
        }
        const cands = free(s);
        if (cands.length > 0) take(uniform(cands));
      }
      return out;
    }

    if (prior.kind === 'meta') {
      let five = MAX_FIVE_STAR - known.filter((c) => c.stars >= 5).length;
      let fourPlus = MAX_FOUR_PLUS - known.filter((c) => c.stars >= 4).length;
      for (let i = 0; i < count; i++) {
        let t = five > 0 && fourPlus > 0 ? 5 : fourPlus > 0 ? 4 : LOW;
        let cands = free(t).slice(0, t === 5 ? META_TOP.five : t === 4 ? META_TOP.four : META_TOP.low);
        if (cands.length === 0 && t !== LOW) {
          // その段のカードが無い(小さい候補集合)時は ★3 以下で埋める
          t = LOW;
          cands = free(LOW).slice(0, META_TOP.low);
        }
        if (cands.length === 0) break;
        take(uniform(cands));
        if (t === 5) five--;
        if (t >= 4) fourPlus--;
      }
      return out;
    }

    // draft: 既知の手札に無いレアリティを、★5 から順に 1 枚ずつ
    const left = [5, 4, 3, 2, 1];
    for (const c of known) {
      const i = left.indexOf(c.stars);
      if (i >= 0) left.splice(i, 1);
    }
    for (let i = 0; i < count; i++) {
      const t = left.length > 0 ? left.shift()! : ANY;
      const cands = free(t);
      if (cands.length === 0) continue;
      // 一様に DRAFT_CHOICES 枚(重複なし)引き、その中で最も強い = 添字が最小のもの
      const n = Math.min(DRAFT_CHOICES, cands.length);
      const drawn = new Set<number>();
      while (drawn.size < n) drawn.add(Math.floor(rng() * cands.length));
      take(cands[Math.min(...drawn)]);
    }
    return out;
  };
}

/**
 * 相手のカードが分からない時に、静的な採点(deckPool)の相手にする代表カード。想定から固定のシードで hands 手札分を引く。
 * 同じ想定と対戦条件なら同じ結果になる
 */
export function priorReference(sampler: HandSampler, seed: string, hands = 12): DeckCard[] {
  const rng = makeRng(hashSeed(`${seed}#ref`));
  const out: DeckCard[] = [];
  for (let i = 0; i < hands; i++) out.push(...sampler(rng, [], 5));
  return out;
}
