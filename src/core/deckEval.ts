import { rootMoves } from './analyze';
import { toFastBoard, type Position } from './position';
import type { Rng } from './rng';
import { RULE_ID, RULE_NAMES, rulesFromIds } from './rules';
import { exactMove, myValueAtLeast, negamax, probeMove } from './search';
import type { CardDef, EngineOptions, Player, RuleSet } from './types';
import { combinations, countCombinations, shuffled } from './worlds';

/**
 * デッキの評価。「対戦が始まった時に起こりうる状況」(シナリオ)を、デッキに依らない 1 つのリストとして先に作り、
 * どのデッキも同じリストで、空の盤面から最後まで読み切って採点する。
 * 同じリストを使うので、サンプリングが入ってもデッキ同士の比較に乱数の差が乗らない(共通乱数)。
 *
 * シナリオ = ルーレットの結果 × 相手の具体的な手札 × 先攻/後攻 × スワップの交換 ×(オーダーなら)相手の並び順 ×(カオスなら)双方の出る順。
 * 各シナリオは完全情報なので結果は厳密だが、相手の手札が裏向きの時は「手札を知っている前提」の楽観側の目安になる。
 *
 * オーダーで相手の並び順を「相手の自由」とする緩和は使わない。NPC も並び順に縛られるのに好きな順で出せることになり、
 * 実在の NPC で測るとどのデッキも全敗になって比較にならなかった。並び順はランダムと見なしてシナリオに展開する。
 */

export interface Matchup {
  /** 対戦前から決まっているルール(盤面に関係するもの。ルーレットとスワップは別に持つ) */
  ruleIds: number[];
  options: EngineOptions;
  oppKnown: CardDef[];
  /** 相手の不明スロットに入りうる候補 */
  oppPool: CardDef[];
  oppUnknown: number;
  /** ルーレットの数(0〜2)。対戦が始まってからルールが加わる */
  roulette: number;
  swap: boolean;
}

/** oppUnknown: 相手の候補カードが足りず、具体的な手札を並べられない */
export type MatchupProblem = 'oppUnknown';

export function matchupProblems(m: Matchup): MatchupProblem[] {
  return m.oppUnknown > 0 && m.oppPool.length < m.oppUnknown ? ['oppUnknown'] : [];
}

const cardKey = (c: CardDef) => `${c.sides.join('.')}t${c.type}`;

export function matchupKey(m: Matchup): string {
  return [
    m.ruleIds.join(','), JSON.stringify(m.options), m.oppKnown.map(cardKey).join(','), m.oppPool.map(cardKey).join(','),
    m.oppUnknown, m.roulette, m.swap ? 1 : 0,
  ].join('|');
}

/** ルーレットの結果 1 つ分(盤面のルールが同じになる結果はまとめる) */
export interface RuleVariant {
  rules: RuleSet;
  swap: boolean;
  /** この結果になるルーレットの出方(加わったルール ID の組)。ルーレットが無ければ [[]] */
  added: number[][];
  /** この結果になる確率 */
  share: number;
}

/**
 * ルーレットで加わりうるルール。どれが等確率で選ばれるかは実機で未確認。
 * ランダムハンドは手持ちから手札が選ばれ、デッキと無関係になるので評価から外す。ドラフトは大会専用。
 */
export const ROULETTE_RULE_IDS: readonly number[] = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14];

const EXCLUSIVE: readonly (readonly [number, number])[] = [[2, 3], [8, 9], [12, 13]];

function conflicts(active: readonly number[], id: number): boolean {
  if (active.includes(id)) return true;
  return EXCLUSIVE.some(([a, b]) => (a === id && active.includes(b)) || (b === id && active.includes(a)));
}

/** 既に有効なルールと、それと排他のルールは選ばれないと仮定する */
export function ruleVariants(m: Matchup): RuleVariant[] {
  const base = m.swap ? [...m.ruleIds, RULE_ID.swap] : m.ruleIds;
  let outcomes: number[][] = [[]];
  for (let i = 0; i < Math.min(2, m.roulette); i++) {
    const next: number[][] = [];
    for (const added of outcomes) {
      for (const id of ROULETTE_RULE_IDS) {
        // 2 つのルーレットの結果は順不同で 1 通りに数える
        if (added.length > 0 && id <= added[added.length - 1]) continue;
        if (!conflicts([...base, ...added], id)) next.push([...added, id]);
      }
    }
    if (next.length > 0) outcomes = next;
  }
  const merged = new Map<string, RuleVariant>();
  for (const added of outcomes) {
    const ids = [...base, ...added];
    const rules = rulesFromIds(ids);
    const swap = ids.includes(RULE_ID.swap);
    // 盤面の進み方に関係する部分だけで同一視する(オープンとサドンデスは評価に影響しない)
    const key = JSON.stringify([rules.same, rules.plus, rules.reverse, rules.fallenAce, rules.typeShift, rules.pick, swap]);
    const v = merged.get(key);
    if (v) v.added.push(added);
    else merged.set(key, { rules, swap, added: [added], share: 0 });
  }
  const variants = [...merged.values()];
  for (const v of variants) v.share = v.added.length / outcomes.length;
  return variants;
}

export function variantLabel(v: RuleVariant): string {
  const names = v.added.map((ids) => (ids.length === 0 ? '追加なし' : ids.map((id) => RULE_NAMES[id]).join(' + ')));
  return names.join('、');
}

export interface Scenario {
  /** ScenarioSet.variants への添字 */
  variant: number;
  /** 相手の具体的な手札。オーダーとカオスでは出る順 */
  oppHand: CardDef[];
  first: Player;
  /** スワップ: 自分のデッキの mine 番目と、相手の手札の theirs 番目を交換する */
  swap?: { mine: number; theirs: number };
  /** カオスのみ: 自分のデッキのスロットが出る順 */
  myOrder?: number[];
  /** このシナリオが代表する確率。全シナリオの合計は 1 */
  weight: number;
}

export interface ScenarioSet {
  variants: RuleVariant[];
  scenarios: Scenario[];
  /** 起こりうる組み合わせを全て並べたか。false ならサンプリング */
  enumerated: boolean;
  /** 相手の具体的な手札の数(サンプリングした時は 0) */
  handCount: number;
}

export interface ScenarioOptions {
  rng: Rng;
  /** シナリオ数の目安。全ての組み合わせがこれ以下なら全列挙する */
  maxScenarios: number;
  /** 相手の具体的な手札を全列挙する上限 */
  maxHands: number;
}

const SLOTS = [0, 1, 2, 3, 4];

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [xs.slice()];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest]));
}

/**
 * シナリオ数の目安。オーダーとカオスは出すカードが決まっていて探索が軽い(1 シナリオ数 ms)ので多く取れる。
 * それ以外は 1 シナリオ 0.1〜0.5 秒かかるので、探索中は少なく、上位のデッキの測り直しで増やす。
 */
export function scenarioBudget(m: Matchup): { search: number; refine: number } {
  const light = ruleVariants(m).every((v) => v.rules.pick !== 'free');
  return light ? { search: 120, refine: 480 } : { search: 24, refine: 96 };
}

export function makeScenarios(m: Matchup, opt: ScenarioOptions): ScenarioSet {
  const variants = ruleVariants(m);
  if (matchupProblems(m).length > 0) return { variants, scenarios: [], enumerated: false, handCount: 0 };

  const q = m.oppUnknown;
  const handsEnumerable = q === 0 || countCombinations(m.oppPool.length, q) <= opt.maxHands;
  const hands: CardDef[][] = q === 0 ? [m.oppKnown] : handsEnumerable ? combinations(m.oppPool, q).map((c) => [...m.oppKnown, ...c]) : [];
  const sizeOf = (v: RuleVariant) => {
    if (v.rules.pick === 'chaos' || !handsEnumerable) return Infinity;
    return hands.length * 2 * (v.swap ? 25 : 1) * (v.rules.pick === 'order' ? 120 : 1);
  };
  const total = variants.reduce((n, v) => n + sizeOf(v), 0);
  const enumerated = total <= opt.maxScenarios;

  const scenarios: Scenario[] = [];
  variants.forEach((v, vi) => {
    const size = sizeOf(v);
    const quota = Math.max(2, 2 * Math.round((opt.maxScenarios * v.share) / 2));
    if (enumerated || size <= quota) {
      const weight = v.share / size;
      for (const hand of hands) {
        for (const oppHand of v.rules.pick === 'order' ? permutations(hand) : [hand]) {
          for (const first of [0, 1] as const) {
            if (!v.swap) scenarios.push({ variant: vi, oppHand, first, weight });
            else for (const mine of SLOTS) for (const theirs of SLOTS) scenarios.push({ variant: vi, oppHand, first, swap: { mine, theirs }, weight });
          }
        }
      }
      return;
    }
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(opt.rng() * xs.length)];
    for (let i = 0; i < quota; i++) {
      const hand = handsEnumerable ? pick(hands) : [...m.oppKnown, ...shuffled(m.oppPool, opt.rng).slice(0, q)];
      scenarios.push({
        variant: vi,
        oppHand: v.rules.pick === 'free' ? hand : shuffled(hand, opt.rng),
        // 先攻/後攻は半々に割り当てる(層別)
        first: (i % 2) as Player,
        swap: v.swap ? { mine: pick(SLOTS), theirs: pick(SLOTS) } : undefined,
        myOrder: v.rules.pick === 'chaos' ? shuffled(SLOTS, opt.rng) : undefined,
        weight: v.share / quota,
      });
    }
  });
  return { variants, scenarios, enumerated, handCount: handsEnumerable ? hands.length : 0 };
}

/**
 * 結果の種類。
 * exact: 各シナリオが対戦開始時に見えている情報だけで決まる(手札が全て既知、またはオールオープン)
 * estimate: 相手の手札を知っている前提の目安 / chaos: 出る順まで知っている前提の目安
 */
export type DeckEvalKind = 'exact' | 'estimate' | 'chaos';

export function deckEvalKind(m: Matchup, set: ScenarioSet): DeckEvalKind {
  const base = rulesFromIds(m.ruleIds);
  if (base.pick === 'chaos') return 'chaos';
  if (set.variants.some((v) => v.rules.pick === 'chaos')) return 'estimate';
  return m.oppUnknown === 0 || base.open === 'all' ? 'exact' : 'estimate';
}

const EMPTY_BOARD: null[] = Array<null>(9).fill(null);

/** シナリオを当てはめた、空の盤面の完全情報の局面。デッキは常に cards[0..4] */
export function scenarioPosition(m: Matchup, set: ScenarioSet, s: Scenario, deck: readonly CardDef[]): Position {
  const v = set.variants[s.variant];
  const my = deck.slice();
  const opp = s.oppHand.slice();
  if (s.swap) {
    // スワップしたカードは、元のカードと同じスロットに入ると仮定する(オーダーの時だけ結果に関係する。実機で未確認)
    my[s.swap.mine] = s.oppHand[s.swap.theirs];
    opp[s.swap.theirs] = deck[s.swap.mine];
  }
  const chaos = v.rules.pick === 'chaos';
  return {
    cards: [...my, ...opp],
    board: EMPTY_BOARD,
    myHand: s.myOrder ?? SLOTS,
    oppKnown: [5, 6, 7, 8, 9],
    oppPool: [],
    oppUnknown: 0,
    turn: s.first,
    first: s.first,
    // カオスの 1 つのシナリオ = 出る順が決まったオーダーの対局
    rules: chaos ? { ...v.rules, pick: 'order' } : v.rules,
    options: m.options,
    // オーダーとカオスでは、シナリオが相手の出る順まで決めている
    oppOrderKnown: v.rules.pick !== 'free',
  };
}

/** 相手が候補のどのカードを持っていても成り立つ結果を調べるための局面(上位集合)。固定ルールのみ */
export function supersetPosition(m: Matchup, deck: readonly CardDef[], first: Player): Position {
  const cards = [...deck, ...m.oppKnown, ...m.oppPool];
  return {
    cards,
    board: EMPTY_BOARD,
    myHand: SLOTS,
    oppKnown: m.oppKnown.map((_, i) => 5 + i),
    oppPool: m.oppPool.map((_, i) => 5 + m.oppKnown.length + i),
    oppUnknown: m.oppUnknown,
    turn: first,
    first,
    rules: rulesFromIds(m.ruleIds),
    options: m.options,
    oppOrderKnown: false,
  };
}

/** 上位集合で保証を調べられるか。ルーレット・スワップ・カオスでは対戦前に局面が決まらないので調べない */
export function supersetApplicable(m: Matchup): boolean {
  if (m.roulette > 0 || m.swap || m.oppUnknown === 0 || rulesFromIds(m.ruleIds).pick === 'chaos') return false;
  return matchupProblems(m).length === 0;
}

/** 空の盤面から、自分の保証値が threshold 以上か。自分が先攻の時は、静的に有望な初手から順に探る */
export function positionAtLeast(pos: Position, threshold: number): boolean {
  const map = toFastBoard(pos);
  if (pos.turn !== 0) return myValueAtLeast(map.board, threshold);
  return rootMoves(pos).some((r) => probeMove(map.board, { card: map.toFast[r.move.card], cell: r.move.cell }, threshold));
}

/** 負けの深さまで求める時の窓。勝ち(1 以上)は区別しないので上端は 1 */
const VALUE_LO = -6;
const VALUE_HI = 1;

/**
 * 空の盤面からの自分の保証値。0 以下は厳密な値(0 = 引き分け、-k = k 枚差の負け)、勝ちは全て 1 にまとめる。
 * 勝ち・引き分け・負けの深さが 1 回の探索で分かる(勝ちと引き分けを別々に探るのとほぼ同じ手間)。
 */
export function positionValue(pos: Position): number {
  const map = toFastBoard(pos);
  const b = map.board;
  let best = -99;
  if (pos.turn !== 0) best = -negamax(b, -VALUE_HI, -VALUE_LO);
  else {
    let alpha = VALUE_LO;
    for (const r of rootMoves(pos)) {
      const v = exactMove(b, { card: map.toFast[r.move.card], cell: r.move.cell }, alpha, VALUE_HI);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= VALUE_HI) break;
    }
  }
  return Math.max(-5, Math.min(VALUE_HI, best));
}

/** search: 探索中に全デッキを比べるシナリオ / refine: 上位のデッキだけを測り直す、より大きいシナリオ */
export type SetName = 'search' | 'refine';

/**
 * win: 勝ちが確定するかだけを探る(安い。今のデッキが勝てるシナリオで、候補を早く落とすのに使う)
 * value: 保証値を求める
 */
export type DeckTask =
  | { id: string; kind: 'scenario'; deckKey: string; deck: CardDef[]; set: SetName; scenario: number; mode: 'win' | 'value' }
  | { id: string; kind: 'superset'; deckKey: string; deck: CardDef[]; first: Player; mode: 'win' | 'draw' };

export type DeckTaskResult =
  | { id: string; kind: 'scenario'; deckKey: string; set: SetName; scenario: number; mode: 'win'; ok: boolean }
  | { id: string; kind: 'scenario'; deckKey: string; set: SetName; scenario: number; mode: 'value'; value: number }
  | { id: string; kind: 'superset'; deckKey: string; first: Player; mode: 'win' | 'draw'; ok: boolean };

export interface DeckContext {
  matchup: Matchup;
  set: ScenarioSet;
  /** サンプリングで探索した時に、上位のデッキを測り直すためのシナリオ。全列挙できていれば null */
  refineSet: ScenarioSet | null;
}

export function runDeckTask(ctx: DeckContext, task: DeckTask): DeckTaskResult {
  if (task.kind === 'superset') {
    const pos = supersetPosition(ctx.matchup, task.deck, task.first);
    return { id: task.id, kind: 'superset', deckKey: task.deckKey, first: task.first, mode: task.mode, ok: positionAtLeast(pos, task.mode === 'win' ? 1 : 0) };
  }
  const set = task.set === 'refine' && ctx.refineSet ? ctx.refineSet : ctx.set;
  const pos = scenarioPosition(ctx.matchup, set, set.scenarios[task.scenario], task.deck);
  const base = { id: task.id, kind: 'scenario', deckKey: task.deckKey, set: task.set, scenario: task.scenario } as const;
  return task.mode === 'win' ? { ...base, mode: 'win', ok: positionAtLeast(pos, 1) } : { ...base, mode: 'value', value: positionValue(pos) };
}
