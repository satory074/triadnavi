import type { Position } from './position';
import type { Rng } from './rng';
import type { CardDef } from './types';

/**
 * 「世界」= 相手の具体的な手札(とカオスでは双方のカードの出る順)の 1 つの仮定。
 * 各世界は完全情報ゲームとして厳密に解ける。集計結果は、各世界で相手の手札を知っている前提になるため
 * 楽観側の推定であり、保証ではない(上位集合の探索が悲観側の保証)。
 */
export interface World {
  /** 相手の未使用の手札の全体(既知 + 仮定した不明スロット)。カオスでは出る順 */
  oppHand: CardDef[];
  /** カオスのみ: 自分のカードが出る順(Position.cards への添字。先頭は今強制されているカード) */
  myOrder?: number[];
  /** 全列挙なら true、サンプリングなら false */
  enumerated: boolean;
}

export function combinations<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (xs.length < k) return [];
  const [head, ...tail] = xs;
  return [...combinations(tail, k - 1).map((c) => [head, ...c]), ...combinations(tail, k)];
}

export function countCombinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1);
  return Math.round(c);
}

export function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 候補リストが無い/足りない時に、不明スロットを埋めるカードを count 枚引く関数(known = 既に決まっている相手のカード)。handPrior.ts が作る */
export type HandFill = (rng: Rng, known: readonly CardDef[], count: number) => CardDef[];

export interface WorldOptions {
  rng: Rng;
  /** 全列挙する上限。これを超えたらサンプリングする */
  maxEnumerate: number;
  /** サンプリングする世界の数 */
  samples: number;
  fill: HandFill;
}

/** 相手の不明スロットの埋め方を列挙またはサンプリングする(カオス以外) */
export function makeWorlds(pos: Position, opt: WorldOptions): World[] {
  const known = pos.oppKnown.map((i) => pos.cards[i]);
  const pool = pos.oppPool.map((i) => pos.cards[i]);
  const q = pos.oppUnknown;
  if (q === 0) return [{ oppHand: known, enumerated: true }];

  if (pool.length >= q) {
    if (countCombinations(pool.length, q) <= opt.maxEnumerate) {
      return combinations(pool, q).map((c) => ({ oppHand: [...known, ...c], enumerated: true }));
    }
    return Array.from({ length: opt.samples }, () => ({
      oppHand: [...known, ...shuffled(pool, opt.rng).slice(0, q)],
      enumerated: false,
    }));
  }
  // 候補が足りない: 候補を優先して使い、残りは想定(handPrior)から引く
  return Array.from({ length: opt.samples }, () => {
    const fromPool = shuffled(pool, opt.rng);
    const rest = opt.fill(opt.rng, [...known, ...fromPool], q - fromPool.length);
    return { oppHand: [...known, ...fromPool, ...rest], enumerated: false };
  });
}

/**
 * カオス用: 相手の手札の仮定に加えて、双方のカードの出る順をサンプリングする。
 * 強制カードが一様ランダムに選ばれるという前提(ゲーム内テキストは「ランダムに決められた順番」)。
 */
export function makeChaosWorlds(pos: Position, opt: WorldOptions): World[] {
  const forced = pos.forcedCard;
  const out: World[] = [];
  for (let i = 0; i < opt.samples; i++) {
    const base = makeWorlds(pos, { ...opt, maxEnumerate: 0, samples: 1 })[0];
    const rest = pos.myHand.filter((c) => c !== forced);
    const myOrder = forced === undefined ? shuffled(pos.myHand, opt.rng) : [forced, ...shuffled(rest, opt.rng)];
    out.push({ oppHand: shuffled(base.oppHand, opt.rng), myOrder, enumerated: false });
  }
  return out;
}

/** 世界を当てはめた完全情報の局面を作る */
export function applyWorld(pos: Position, world: World): Position {
  const cards = pos.cards.slice();
  const oppKnown = world.oppHand.map((c) => {
    cards.push(c);
    return cards.length - 1;
  });
  const chaos = world.myOrder !== undefined;
  return {
    ...pos,
    cards,
    oppKnown,
    oppPool: [],
    oppUnknown: 0,
    myHand: world.myOrder ?? pos.myHand,
    // カオスの 1 つの世界 = 出る順が決まったオーダーの対局
    rules: chaos ? { ...pos.rules, pick: 'order' } : pos.rules,
    forcedCard: chaos ? undefined : pos.forcedCard,
    oppOrderKnown: chaos ? true : false,
  };
}
