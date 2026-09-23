import { MAX_FIVE_STAR, MAX_FOUR_PLUS, DECK_SIZE, canReplace, isLegalDeck, type DeckCard } from './collection';
import { ruleVariants, type Matchup } from './deckEval';
import { captures } from './refEngine';
import type { CardDef, RuleSet } from './types';

/**
 * デッキ探索の候補の絞り込み。合法なデッキは手持ち 200〜475 枚で 10^9〜10^11 通りあり、全ては調べられないので、
 * 相手のカード(NPC なら最大 9 枚が分かっている)に対する強さでカードを採点し、レアリティの枠ごとに上位だけを候補にする。
 *
 * 「全ての辺が上回るカードに替えれば悪くならない」という絞り込み(支配)は使わない。取られたカードは相手のために
 * その高い数字で守るので、基本ルールだけでも成り立たない(反例は deckPool.test.ts。ランダムな局面での実測では、
 * 強いカードに替えて保証値が下がる割合は基本ルールで約 0.1%、セイム+プラスで約 5%)。
 * したがって、ここで落としたカードを含むデッキが最良である可能性は残る。探索の結果は「見つかった中で最良」であり、
 * 最善のデッキだとは言わない。
 */

export interface DeckPools {
  /** ★5 の枠の候補 */
  five: DeckCard[];
  /** ★4 の枠の候補 */
  four: DeckCard[];
  /** ★3 以下の候補 */
  low: DeckCard[];
  /** 手持ちの全カードの点数(カード ID → 点)。デッキの静的な評価とタイブレークに使う */
  score: Record<number, number>;
}

export interface PoolOptions {
  perFive: number;
  perFour: number;
  low: number;
  /** セイム/プラスで数字が噛み合うカードを、点数と別枠で各枠に足す数 */
  special: number;
}

export const DEFAULT_POOL_OPTIONS: PoolOptions = { perFive: 10, perFour: 10, low: 20, special: 6 };

const OPPOSITE = [2, 3, 0, 1];
/** 同時に盤面の別のカードと接しうる辺の組(隣り合う 4 組と、向かい合う 2 組) */
const SIDE_PAIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]];
const ADJACENT_PAIRS = SIDE_PAIRS.slice(0, 4);

const mean = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** 相手のカードが分からない時は、1〜A が均等に出ると見なす */
const UNIFORM: readonly CardDef[] = Array.from({ length: 10 }, (_, i) => ({ sides: [i + 1, i + 1, i + 1, i + 1], type: 0 }) as CardDef);

function scoreUnder(card: CardDef, opp: readonly CardDef[], rules: RuleSet): number {
  // 辺ごとに、その辺で取れる相手の辺の割合と、その辺を取られない割合。実際の支配判定を使うので、
  // リバースやエースキラーを個別に扱わなくてよい
  const attack = card.sides.map((v, d) => mean(opp.map((o) => (captures(v, o.sides[OPPOSITE[d]], rules.reverse, rules.fallenAce) ? 1 : 0))));
  const defend = card.sides.map((v, d) => mean(opp.map((o) => (captures(o.sides[OPPOSITE[d]], v, rules.reverse, rules.fallenAce) ? 0 : 1))));
  // 角に置くと 2 辺しか晒さない。隣り合う 2 辺の守りの最良を「角の強さ」として重く見る
  const corner = Math.max(...ADJACENT_PAIRS.map(([a, b]) => (defend[a] + defend[b]) / 2));
  let score = mean(attack) * 0.5 + mean(defend) * 0.5 + corner * 0.75;

  if (rules.typeShift !== 'none' && card.type !== 0) {
    // タイプ補正で数字が上がるのが得かどうか。リバースでは逆になる
    const gain = (rules.typeShift === 'asc') !== rules.reverse;
    const shared = mean(opp.map((o) => (o.type === card.type ? 1 : 0)));
    // 得な補正は、相手が同じタイプを使わないほど自分だけが得をする。損な補正は、相手が同じタイプを使うほど深くなる
    score += gain ? 0.1 * (1 - shared) : -(0.05 + 0.15 * shared);
  }
  return score;
}

/** セイム/プラスで、このカードの 2 辺が相手のカードと同時に噛み合う見込み */
function comboPotential(card: CardDef, opp: readonly CardDef[], rules: RuleSet): number {
  if (!rules.same && !rules.plus) return 0;
  let total = 0;
  for (const [a, b] of SIDE_PAIRS) {
    if (rules.same) {
      const pa = mean(opp.map((o) => (o.sides[OPPOSITE[a]] === card.sides[a] ? 1 : 0)));
      const pb = mean(opp.map((o) => (o.sides[OPPOSITE[b]] === card.sides[b] ? 1 : 0)));
      total += pa * pb;
    }
    if (rules.plus) {
      let hit = 0;
      for (const x of opp) for (const y of opp) if (x !== y && card.sides[a] + x.sides[OPPOSITE[a]] === card.sides[b] + y.sides[OPPOSITE[b]]) hit++;
      total += opp.length > 1 ? hit / (opp.length * (opp.length - 1)) : 0;
    }
  }
  return total;
}

/** 相手のカード。分かっているものが無ければ、想定から引いた代表カード(m.oppRef)、それも無ければ一様 */
function opponentCards(m: Matchup): readonly CardDef[] {
  const all = [...m.oppKnown, ...m.oppPool];
  if (all.length > 0) return all;
  return m.oppRef && m.oppRef.length > 0 ? m.oppRef : UNIFORM;
}

/** 相手のカードを知らない時のカードの強さ(1〜A が均等に出ると見なす)。相手の手札の想定(handPrior)がこれで段の中を並べる */
export function staticStrength(card: CardDef, rules: RuleSet): number {
  return scoreUnder(card, UNIFORM, rules);
}

/** ルーレットがある時は、起こりうるルールごとの点を確率で平均する */
export function cardScore(card: CardDef, m: Matchup): number {
  const opp = opponentCards(m);
  return ruleVariants(m).reduce((a, v) => a + v.share * scoreUnder(card, opp, v.rules), 0);
}

export function cardPotential(card: CardDef, m: Matchup): number {
  const opp = opponentCards(m);
  return ruleVariants(m).reduce((a, v) => a + v.share * comboPotential(card, opp, v.rules), 0);
}

export function buildPools(owned: readonly DeckCard[], m: Matchup, opt: PoolOptions = DEFAULT_POOL_OPTIONS): DeckPools {
  const score: Record<number, number> = {};
  const potential: Record<number, number> = {};
  for (const c of owned) {
    score[c.id] = cardScore(c, m);
    potential[c.id] = cardPotential(c, m);
  }
  const by = (key: Record<number, number>) => (a: DeckCard, b: DeckCard) => key[b.id] - key[a.id] || a.id - b.id;
  const pick = (cards: DeckCard[], n: number) => {
    const top = [...cards].sort(by(score)).slice(0, n);
    const extra = [...cards].filter((c) => potential[c.id] > 0 && !top.includes(c)).sort(by(potential)).slice(0, opt.special);
    return [...top, ...extra].sort(by(score));
  };
  return {
    five: pick(owned.filter((c) => c.stars >= 5), opt.perFive),
    four: pick(owned.filter((c) => c.stars === 4), opt.perFour),
    low: pick(owned.filter((c) => c.stars <= 3), opt.low),
    score,
  };
}

export function poolCards(pools: DeckPools): DeckCard[] {
  return [...pools.five, ...pools.four, ...pools.low];
}

export function deckHeuristic(deck: readonly DeckCard[], pools: DeckPools): number {
  return deck.reduce((a, c) => a + (pools.score[c.id] ?? 0), 0);
}

const signature = (c: CardDef) => `${c.sides.join('.')}t${c.type}`;

/**
 * 評価の同一性のキー。数字とタイプが同じなら別のカードでも結果は同じなので、ID ではなく数字で作る。
 * 並び順が結果に関係する時(オーダー)だけ順序を区別する。
 */
export function deckKey(deck: readonly CardDef[], ordered: boolean): string {
  const sigs = deck.map(signature);
  return (ordered ? sigs : sigs.sort()).join('|');
}

/** 点数順に、合法である限り詰めていく */
function greedyDeck(sorted: readonly DeckCard[], maxFive = MAX_FIVE_STAR, maxFourPlus = MAX_FOUR_PLUS): DeckCard[] | null {
  const deck: DeckCard[] = [];
  let five = 0;
  let fourPlus = 0;
  for (const c of sorted) {
    if (deck.length === DECK_SIZE) break;
    if (c.stars >= 5 && five >= maxFive) continue;
    if (c.stars >= 4 && fourPlus >= maxFourPlus) continue;
    deck.push(c);
    if (c.stars >= 5) five++;
    if (c.stars >= 4) fourPlus++;
  }
  return deck.length === DECK_SIZE && isLegalDeck(deck) ? deck : null;
}

/**
 * 探索の出発点。利用者のデッキ(今の手札や保存済みデッキ)を先頭に置き、その後に ★4 以上の使い方(5 通り)ごとの点数最良と、
 * ルールに合わせた型(数字の噛み合わせ、単一タイプ、タイプなし)。出発点は並びの順に評価されるので、利用者のデッキが最初に片付く
 * (最良のデッキがすでに組んであるなら、ゲーム内でデッキを編集しなくて済む)。オーダーでは後攻だと 5 枚目を出さないので、弱いカードを後ろにする。
 */
export function seedDecks(pools: DeckPools, m: Matchup, extra: readonly DeckCard[][]): DeckCard[][] {
  const all = poolCards(pools);
  const byScore = (a: DeckCard, b: DeckCard) => pools.score[b.id] - pools.score[a.id] || a.id - b.id;
  const sorted = [...all].sort(byScore);
  const out: (DeckCard[] | null)[] = [];
  for (const deck of extra) if (deck.length === DECK_SIZE) out.push([...deck]);
  for (const [five, fourPlus] of [[1, 2], [0, 2], [1, 1], [0, 1], [0, 0]]) out.push(greedyDeck(sorted, five, fourPlus));

  const variants = ruleVariants(m);
  if (variants.some((v) => v.rules.same || v.rules.plus)) {
    const potential = new Map(all.map((c) => [c.id, cardPotential(c, m)]));
    out.push(greedyDeck([...all].sort((a, b) => potential.get(b.id)! + pools.score[b.id] * 0.1 - (potential.get(a.id)! + pools.score[a.id] * 0.1) || a.id - b.id)));
  }
  if (variants.some((v) => v.rules.typeShift !== 'none')) {
    for (const type of [0, 1, 2, 3, 4]) out.push(greedyDeck(sorted.filter((c) => c.type === type)));
  }

  const seen = new Set<string>();
  return out.filter((d): d is DeckCard[] => {
    if (!d) return false;
    const key = deckKey(d, true);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 1 手で行けるデッキ: 1 枚を候補のカードに替えたもの。並び順が関係する時は、2 枚の位置の入れ替えを先に試す
 * (カードを替えるより安く、オーダーでは効きやすい)。カードの入れ替えは、静的な点数の伸びが大きい順。
 */
export function neighbours(deck: readonly DeckCard[], pools: DeckPools, ordered: boolean): DeckCard[][] {
  const out: DeckCard[][] = [];
  if (ordered) {
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        const d = [...deck];
        [d[i], d[j]] = [d[j], d[i]];
        out.push(d);
      }
    }
  }
  const inDeck = new Set(deck.map((c) => c.id));
  const swaps: { deck: DeckCard[]; gain: number; slot: number; id: number }[] = [];
  for (const card of poolCards(pools)) {
    if (inDeck.has(card.id)) continue;
    for (let slot = 0; slot < deck.length; slot++) {
      if (!canReplace(deck, slot, card)) continue;
      const d = [...deck];
      d[slot] = card;
      swaps.push({ deck: d, gain: pools.score[card.id] - (pools.score[deck[slot].id] ?? 0), slot, id: card.id });
    }
  }
  swaps.sort((a, b) => b.gain - a.gain || a.id - b.id || a.slot - b.slot);
  out.push(...swaps.map((s) => s.deck));

  const seen = new Set([deckKey(deck, ordered)]);
  return out.filter((d) => {
    const key = deckKey(d, ordered);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
