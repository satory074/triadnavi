import { deckProblems, type DeckCard, type DeckProblem } from './collection';
import type { DeckContext, DeckEvalKind, DeckTask, DeckTaskResult, Matchup, ScenarioSet, SetName } from './deckEval';
import { deckEvalKind, makeScenarios, matchupKey, runDeckTask, scenarioBudget, supersetApplicable } from './deckEval';
import { buildPools, deckHeuristic, deckKey, neighbours, seedDecks, type DeckPools, type PoolOptions } from './deckPool';
import { hashSeed, makeRng } from './rng';
import type { Player } from './types';
import type { HandFill } from './worlds';

/**
 * デッキ探索の進行(純関数の状態機械。core/scheduler.ts と同じ流儀で、ワーカーの有無に依らずテストできる)。
 *
 *   seeds   出発点のデッキを全シナリオで評価する
 *   climb   今のデッキの 1 手先(1 枚の入れ替え、オーダーなら位置の入れ替えも)を調べ、良くなるものがあれば移る
 *   refine  サンプリングで探索した時に、上位のデッキだけを大きいシナリオで測り直す
 *   certify 上位のデッキについて、相手が候補のどのカードを持っていても成り立つか(上位集合)を調べる
 *
 * 決定性: 「世代」ごとに、比べる相手(bound)とシナリオを調べる順を固定し、世代の全デッキが片付いてから次へ進む。
 * デッキが世代の中で片付く条件(最後まで評価、または bound を上回れないと確定)は真の値だけで決まるので、
 * ワーカーの数や結果の届く順が違っても同じデッキに行き着く。予算も時間ではなくデッキ数で数える。
 */

export interface ScenarioInfo {
  weight: number;
  first: Player;
}

/**
 * シナリオごとの結果。undefined は未評価。
 * value は保証値(1 = 勝ち、0 = 引き分け、-k = k 枚差の負け)。win / draw は安い探りの結果で、
 * win が当たれば value = 1、win が外れて draw が当たれば value = 0 と決まる。どちらも外れた時だけ、負けの深さを別に求める。
 */
export interface Tally {
  win: (boolean | undefined)[];
  draw: (boolean | undefined)[];
  value: (number | undefined)[];
}

/**
 * デッキの点。勝ちの確率 → 引き分け以上の確率 → 負ける時の枚数差の小ささ → 静的な点、の順に比べる。
 * 強い NPC では相手が最善を尽くすとどのデッキも勝てないので、負けの浅さまで見ないと差がつかない。
 */
export interface DeckScore {
  /** 勝ちが確定するシナリオの重みの合計(= 確率) */
  win: number;
  /** 引き分け以上が確定するシナリオの重みの合計(win を含む) */
  drawOrBetter: number;
  /** 負けるシナリオの枚数差の、重みつきの合計(= 保証される枚数差の期待値の、負けの分) */
  deficit: number;
  heuristic: number;
}

export type SupersetResult = 'win' | 'draw' | 'none';

export interface DeckEval {
  key: string;
  cards: DeckCard[];
  heuristic: number;
  tally: Tally;
  /** 測り直しの結果(refine フェーズで上位のデッキだけ) */
  refined?: Tally;
  /** bound を上回れないと分かって、評価を途中で打ち切った */
  pruned: boolean;
  /** 先攻(0)/後攻(1)ごとの上位集合の結果。調べていなければ無い */
  superset: Partial<Record<Player, SupersetResult>>;
}

export interface DeckSearchOptions {
  /** false なら出発点のデッキを評価するだけ(「今のデッキを評価」) */
  climb: boolean;
  /** 1 世代で調べるデッキ数 */
  generationSize: number;
  /** climb で調べるデッキ数の上限 */
  maxDecks: number;
  /** 行き止まりの後、別の出発点からやり直す回数 */
  restarts: number;
  /** 測り直しと保証の確認をする上位のデッキ数 */
  keep: number;
}

/**
 * 強い NPC では 1 デッキの評価に 1〜2 秒(4 ワーカー)かかり、今のデッキが勝てない間は打ち切りも効かない
 * (どのシナリオでも勝ちうる限り、上回る可能性が残る)。数分で終わる規模にしておき、途中経過を常に見せる。
 */
export const DEFAULT_SEARCH_OPTIONS: DeckSearchOptions = { climb: true, generationSize: 12, maxDecks: 240, restarts: 1, keep: 3 };

export type SearchPhase = 'seeds' | 'climb' | 'refine' | 'certify' | 'done';
export type StopReason = 'evaluated' | 'perfect' | 'exhausted' | 'budget';

interface Generation {
  decks: string[];
  bound: DeckScore | null;
  /** シナリオを調べる順(過去に勝てなかった回数が多い順)。世代の間は固定 */
  order: number[];
  set: SetName;
  superset: boolean;
}

export interface DeckSearch {
  key: string;
  ordered: boolean;
  scenarios: ScenarioInfo[];
  refineScenarios: ScenarioInfo[] | null;
  supersetOk: boolean;
  options: DeckSearchOptions;
  pools: DeckPools | null;
  phase: SearchPhase;
  stopReason?: StopReason;
  evals: Record<string, DeckEval>;
  seeds: string[];
  /** climb の出発点に使ったデッキ */
  climbed: string[];
  current: string | null;
  generation: Generation;
  /** シナリオごとの、勝てなかったデッキの数 */
  failCount: number[];
  restartsLeft: number;
  /** climb で片付いたデッキ数(打ち切りを含む) */
  climbDecks: number;
  /** 実行した探りの数(進み具合の表示と、打ち切りの効き目の確認用) */
  probes: number;
  inflight: Record<string, number>;
  /** 今の世代のタスクの状態。世代が替わったら消す(溜め続けると、結果 1 件ごとのコピーが重くなる) */
  tasks: Record<string, 'issued' | 'done'>;
}

const EPS = 1e-9;

export function compareScores(a: DeckScore, b: DeckScore): number {
  if (Math.abs(a.win - b.win) > EPS) return a.win - b.win;
  if (Math.abs(a.drawOrBetter - b.drawOrBetter) > EPS) return a.drawOrBetter - b.drawOrBetter;
  if (Math.abs(a.deficit - b.deficit) > EPS) return b.deficit - a.deficit;
  return a.heuristic - b.heuristic;
}

function emptyTally(n: number): Tally {
  const blank = () => Array<undefined>(n).fill(undefined);
  return { win: blank(), draw: blank(), value: blank() };
}

interface TallyState {
  win: number;
  drawOrBetter: number;
  deficit: number;
  /** まだ勝ちうるシナリオの重み(何も調べていないもの) */
  winLeft: number;
  /** 勝ちではないと分かったが、引き分け以上かをまだ調べていないシナリオの重み */
  drawLeft: number;
  complete: boolean;
}

function tallyState(t: Tally, scenarios: readonly ScenarioInfo[]): TallyState {
  const s: TallyState = { win: 0, drawOrBetter: 0, deficit: 0, winLeft: 0, drawLeft: 0, complete: true };
  scenarios.forEach((sc, i) => {
    const v = t.value[i];
    if (v === undefined) {
      s.complete = false;
      if (t.win[i] === undefined) s.winLeft += sc.weight;
      else if (t.draw[i] === undefined) s.drawLeft += sc.weight;
      // 負けと分かっていて深さが未評価: 少なくとも 1 枚差はある
      else s.deficit += sc.weight;
    } else if (v >= 1) {
      s.win += sc.weight;
      s.drawOrBetter += sc.weight;
    } else if (v === 0) s.drawOrBetter += sc.weight;
    else s.deficit += sc.weight * -v;
  });
  return s;
}

function scenariosOf(s: DeckSearch, set: SetName): ScenarioInfo[] {
  return set === 'refine' && s.refineScenarios ? s.refineScenarios : s.scenarios;
}

function tallyOf(e: DeckEval, set: SetName): Tally | undefined {
  return set === 'refine' ? e.refined : e.tally;
}

export function isComplete(s: DeckSearch, e: DeckEval, set: SetName = 'search'): boolean {
  const t = tallyOf(e, set);
  return t !== undefined && tallyState(t, scenariosOf(s, set)).complete;
}

/** 最終的な点。測り直しが済んでいればそちらを使う */
export function deckScore(s: DeckSearch, e: DeckEval): DeckScore {
  const refined = e.refined && isComplete(s, e, 'refine');
  const st = tallyState(refined ? e.refined! : e.tally, scenariosOf(s, refined ? 'refine' : 'search'));
  return { win: st.win, drawOrBetter: st.drawOrBetter, deficit: st.deficit, heuristic: e.heuristic };
}

function searchScore(s: DeckSearch, e: DeckEval): DeckScore {
  const st = tallyState(e.tally, s.scenarios);
  return { win: st.win, drawOrBetter: st.drawOrBetter, deficit: st.deficit, heuristic: e.heuristic };
}

/** bound を上回る可能性がもう無いか(上回る = 辞書式に真に大きい)。未評価のシナリオは最良の場合で見積もる */
function cannotBeat(st: TallyState, heuristic: number, bound: DeckScore): boolean {
  const best: DeckScore = { win: st.win + st.winLeft, drawOrBetter: st.drawOrBetter + st.winLeft + st.drawLeft, deficit: st.deficit, heuristic };
  return compareScores(best, bound) <= 0;
}

export interface SearchInput {
  key: string;
  ordered: boolean;
  set: ScenarioSet;
  refineSet: ScenarioSet | null;
  supersetOk: boolean;
  pools: DeckPools | null;
  seeds: DeckCard[][];
  options: DeckSearchOptions;
}

const info = (set: ScenarioSet): ScenarioInfo[] => set.scenarios.map((x) => ({ weight: x.weight, first: x.first }));

function newEval(s: Pick<DeckSearch, 'ordered' | 'scenarios' | 'pools'>, cards: DeckCard[]): DeckEval {
  return {
    key: deckKey(cards, s.ordered),
    cards,
    heuristic: s.pools ? deckHeuristic(cards, s.pools) : 0,
    tally: emptyTally(s.scenarios.length),
    pruned: false,
    superset: {},
  };
}

export function createDeckSearch(input: SearchInput): DeckSearch {
  const scenarios = info(input.set);
  const base = { ordered: input.ordered, scenarios, pools: input.pools };
  const evals: Record<string, DeckEval> = {};
  for (const cards of input.seeds) {
    const e = newEval(base, cards);
    if (!(e.key in evals)) evals[e.key] = e;
  }
  const seeds = Object.keys(evals);
  const s: DeckSearch = {
    key: input.key,
    ordered: input.ordered,
    scenarios,
    refineScenarios: input.refineSet ? info(input.refineSet) : null,
    supersetOk: input.supersetOk,
    options: input.options,
    pools: input.pools,
    phase: 'seeds',
    evals,
    seeds,
    climbed: [],
    current: null,
    generation: { decks: seeds, bound: null, order: scenarios.map((_, i) => i), set: 'search', superset: false },
    failCount: scenarios.map(() => 0),
    restartsLeft: input.options.restarts,
    climbDecks: 0,
    probes: 0,
    inflight: {},
    tasks: {},
  };
  return settle(s);
}

type ScenarioMode = 'win' | 'draw' | 'value';
const scenarioTaskId = (key: string, set: SetName, i: number, mode: ScenarioMode) => `${key}#${set}${i}#${mode}`;
const supersetTaskId = (key: string, first: Player, mode: 'win' | 'draw') => `${key}#superset${first}#${mode}`;

/** 先攻 first のシナリオが全て勝ち/引き分け以上なら、上位集合で確かめる価値がある */
function supersetMode(s: DeckSearch, e: DeckEval, first: Player): 'win' | 'draw' | null {
  const set: SetName = e.refined && isComplete(s, e, 'refine') ? 'refine' : 'search';
  const t = tallyOf(e, set)!;
  const idx = scenariosOf(s, set).map((sc, i) => (sc.first === first ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return null;
  if (idx.every((i) => (t.value[i] ?? -1) >= 1)) return 'win';
  if (idx.every((i) => (t.value[i] ?? -1) >= 0)) return 'draw';
  return null;
}

function supersetTasks(s: DeckSearch, e: DeckEval): DeckTask[] {
  const out: DeckTask[] = [];
  for (const first of [0, 1] as const) {
    if (e.superset[first] !== undefined) continue;
    const mode = supersetMode(s, e, first);
    if (mode) out.push({ id: supersetTaskId(e.key, first, mode), kind: 'superset', deckKey: e.key, deck: e.cards, first, mode });
  }
  return out;
}

/** このデッキについて、今の世代で次に出せるタスク。bound がある時は 1 つずつ(結果を見て打ち切るため) */
function pendingTasks(s: DeckSearch, e: DeckEval): DeckTask[] {
  const g = s.generation;
  if (g.superset) return supersetTasks(s, e).filter((t) => s.tasks[t.id] === undefined);
  if (e.pruned) return [];
  const t = tallyOf(e, g.set);
  if (!t) return [];
  const task = (i: number, mode: ScenarioMode): DeckTask => ({
    id: scenarioTaskId(e.key, g.set, i, mode), kind: 'scenario', deckKey: e.key, deck: e.cards, set: g.set, scenario: i, mode,
  });
  const stage = (i: number): ScenarioMode => (t.win[i] === undefined ? 'win' : t.draw[i] === undefined ? 'draw' : 'value');
  const open = g.order.filter((i) => t.value[i] === undefined);
  // 比べる相手がいない時(出発点、測り直し)は、各シナリオの次の段階を並行して進める
  if (g.bound === null) return open.map((i) => task(i, stage(i))).filter((x) => s.tasks[x.id] === undefined);
  if ((s.inflight[e.key] ?? 0) > 0) return [];
  // 比べる相手がいる時は 1 つずつ、段階の浅いものから(勝ち → 引き分け → 負けの深さ)。比べる順も同じなので、
  // 勝ちの数で上回れない候補は引き分けを調べずに、引き分け以上の数で上回れない候補は重い探索をせずに落とせる
  for (const mode of ['win', 'draw', 'value'] as const) {
    const i = open.find((k) => stage(k) === mode);
    if (i !== undefined) return s.tasks[scenarioTaskId(e.key, g.set, i, mode)] === undefined ? [task(i, mode)] : [];
  }
  return [];
}

export function nextDeckTasks(s: DeckSearch, n: number): DeckTask[] {
  const out: DeckTask[] = [];
  for (const key of s.generation.decks) {
    if (out.length >= n) break;
    out.push(...pendingTasks(s, s.evals[key]).slice(0, n - out.length));
  }
  return out;
}

export function markDeckIssued(s: DeckSearch, tasks: readonly DeckTask[]): DeckSearch {
  if (tasks.length === 0) return s;
  const issued = { ...s.tasks };
  const inflight = { ...s.inflight };
  for (const t of tasks) {
    issued[t.id] = 'issued';
    inflight[t.deckKey] = (inflight[t.deckKey] ?? 0) + 1;
  }
  return { ...s, tasks: issued, inflight };
}

export function applyDeckResult(s: DeckSearch, r: DeckTaskResult): DeckSearch {
  if (s.tasks[r.id] !== 'issued') return s;
  const e = s.evals[r.deckKey];
  if (!e) return s;
  let next: DeckEval;
  if (r.kind === 'superset') {
    next = { ...e, superset: { ...e.superset, [r.first]: r.ok ? r.mode : 'none' } };
  } else {
    const t = tallyOf(e, r.set) ?? emptyTally(scenariosOf(s, r.set).length);
    const updated: Tally = { win: t.win.slice(), draw: t.draw.slice(), value: t.value.slice() };
    if (r.mode === 'value') updated.value[r.scenario] = r.value;
    else if (r.mode === 'win') {
      updated.win[r.scenario] = r.ok;
      if (r.ok) updated.value[r.scenario] = 1;
    } else {
      updated.draw[r.scenario] = r.ok;
      if (r.ok) updated.value[r.scenario] = 0;
    }
    next = r.set === 'refine' ? { ...e, refined: updated } : { ...e, tally: updated };
    const bound = s.generation.bound;
    const st = tallyState(updated, s.scenarios);
    if (bound && r.set === 'search' && !st.complete && cannotBeat(st, e.heuristic, bound)) next = { ...next, pruned: true };
  }
  return settle({
    ...s,
    probes: s.probes + 1,
    evals: { ...s.evals, [r.deckKey]: next },
    tasks: { ...s.tasks, [r.id]: 'done' },
    inflight: { ...s.inflight, [r.deckKey]: Math.max(0, (s.inflight[r.deckKey] ?? 0) - 1) },
  });
}

function generationDone(s: DeckSearch): boolean {
  const g = s.generation;
  return g.decks.every((key) => {
    const e = s.evals[key];
    if ((s.inflight[key] ?? 0) > 0) return false;
    if (g.superset) return supersetTasks(s, e).length === 0;
    return e.pruned || isComplete(s, e, g.set);
  });
}

/** 世代が片付いていれば次へ進める。空の世代が続く時(保証の確認が不要など)は、まとめて進む */
function settle(s: DeckSearch): DeckSearch {
  let cur = s;
  // 世代が片付いた時点で計算中のタスクは残っていないので、前の世代のタスクの記録は要らない
  while (cur.phase !== 'done' && generationDone(cur)) cur = { ...advance(cur), tasks: {}, inflight: {} };
  return cur;
}

function rankedKeys(s: DeckSearch, score: (e: DeckEval) => DeckScore): string[] {
  return Object.values(s.evals)
    .filter((e) => !e.pruned && isComplete(s, e))
    .sort((a, b) => compareScores(score(b), score(a)) || (a.key < b.key ? -1 : 1))
    .map((e) => e.key);
}

const isPerfect = (score: DeckScore) => score.win > 1 - EPS;

function scenarioOrder(failCount: readonly number[]): number[] {
  return failCount.map((_, i) => i).sort((a, b) => failCount[b] - failCount[a] || a - b);
}

/** climb の次の世代: 今のデッキの 1 手先のうち、まだ調べていないもの */
function climbGeneration(s: DeckSearch, current: string): DeckSearch | null {
  if (!s.pools) return null;
  const fresh: DeckEval[] = [];
  const seen = new Set<string>();
  for (const cards of neighbours(s.evals[current].cards, s.pools, s.ordered)) {
    if (fresh.length >= s.options.generationSize) break;
    const e = newEval(s, cards);
    if (e.key in s.evals || seen.has(e.key)) continue;
    seen.add(e.key);
    fresh.push(e);
  }
  if (fresh.length === 0) return null;
  const evals = { ...s.evals };
  for (const e of fresh) evals[e.key] = e;
  return {
    ...s,
    phase: 'climb',
    current,
    evals,
    generation: {
      decks: fresh.map((e) => e.key),
      bound: searchScore(s, s.evals[current]),
      order: scenarioOrder(s.failCount),
      set: 'search',
      superset: false,
    },
  };
}

function finish(s: DeckSearch, stopReason: StopReason): DeckSearch {
  const top = rankedKeys(s, (e) => searchScore(s, e)).slice(0, s.options.keep);
  const base = { ...s, stopReason: s.stopReason ?? stopReason };
  if (s.refineScenarios && top.length > 0) {
    const n = s.refineScenarios.length;
    const evals = { ...s.evals };
    for (const key of top) evals[key] = { ...evals[key], refined: emptyTally(n) };
    return { ...base, phase: 'refine', evals, generation: { decks: top, bound: null, order: s.refineScenarios.map((_, i) => i), set: 'refine', superset: false } };
  }
  return certify(base);
}

function certify(s: DeckSearch): DeckSearch {
  if (!s.supersetOk) return { ...s, phase: 'done', generation: { ...s.generation, decks: [] } };
  const top = rankedKeys(s, (e) => deckScore(s, e)).slice(0, s.options.keep);
  return { ...s, phase: 'certify', generation: { decks: top, bound: null, order: [], set: 'search', superset: true } };
}

function advance(s: DeckSearch): DeckSearch {
  if (s.phase === 'refine') return certify(s);
  if (s.phase === 'certify') return { ...s, phase: 'done', generation: { ...s.generation, decks: [] } };

  // seeds / climb の世代が終わった: 勝てなかったシナリオを数え直す(次の世代で先に調べる)
  const failCount = s.failCount.slice();
  for (const key of s.generation.decks) s.evals[key].tally.win.forEach((w, i) => { if (w === false) failCount[i]++; });
  let cur: DeckSearch = { ...s, failCount, climbDecks: s.phase === 'climb' ? s.climbDecks + s.generation.decks.length : s.climbDecks };

  const ranked = rankedKeys(cur, (e) => searchScore(cur, e));
  if (ranked.length === 0) return { ...cur, phase: 'done', stopReason: 'evaluated', generation: { ...cur.generation, decks: [] } };
  if (!cur.options.climb) return finish(cur, 'evaluated');
  if (isPerfect(searchScore(cur, cur.evals[ranked[0]]))) return finish(cur, 'perfect');
  if (cur.climbDecks >= cur.options.maxDecks) return finish(cur, 'budget');

  // 移る先: climb 中は、この世代で今のデッキを上回ったものの最良。無ければ今のデッキの残りの 1 手先を続ける
  let current = cur.current;
  if (current === null) {
    current = ranked[0];
    cur = { ...cur, climbed: [current] };
  } else {
    const bound = cur.generation.bound!;
    const better = cur.generation.decks
      .map((k) => cur.evals[k])
      .filter((e) => !e.pruned && compareScores(searchScore(cur, e), bound) > 0)
      .sort((a, b) => compareScores(searchScore(cur, b), searchScore(cur, a)) || (a.key < b.key ? -1 : 1));
    if (better.length > 0) current = better[0].key;
  }

  for (;;) {
    const next = climbGeneration(cur, current);
    if (next) return next;
    // 行き止まり。まだ出発点にしていないシードのうち最良のものからやり直す
    const restart = cur.restartsLeft > 0 ? ranked.find((k) => cur.seeds.includes(k) && !cur.climbed.includes(k)) : undefined;
    if (restart === undefined) return finish(cur, 'exhausted');
    current = restart;
    cur = { ...cur, restartsLeft: cur.restartsLeft - 1, climbed: [...cur.climbed, restart] };
  }
}

export interface DeckSearchProgress {
  phase: SearchPhase;
  /** 最後まで評価したデッキ数 */
  decksDone: number;
  /** 途中で打ち切ったデッキ数 */
  decksPruned: number;
  generationDone: number;
  generationTotal: number;
  complete: boolean;
  /** 進み具合(0〜1)。deckSearchRatio を見よ */
  ratio: number;
}

export function deckSearchProgress(s: DeckSearch): DeckSearchProgress {
  const all = Object.values(s.evals);
  const g = s.generation;
  return {
    phase: s.phase,
    decksDone: all.filter((e) => !e.pruned && isComplete(s, e)).length,
    decksPruned: all.filter((e) => e.pruned).length,
    generationDone: g.superset ? 0 : g.decks.filter((k) => s.evals[k].pruned || isComplete(s, s.evals[k], g.set)).length,
    generationTotal: g.decks.length,
    complete: s.phase === 'done',
    ratio: deckSearchRatio(s),
  };
}

/**
 * climb のデッキ 1 つにかかる計算の、全シナリオを最後まで調べる場合(出発点のデッキ)に対する割合の見込み。
 * 今のデッキを上回れないと分かった時点で打ち切るので軽い。ブラウザの実測(イソベ = プラス・スワップ、手持ち 200 枚)で、
 * 出発点 6 個に 41 秒、climb 240 個に約 320 秒だった(1 個あたり出発点の 0.2〜0.35 倍。今のデッキが強くなる後半ほど軽い)
 */
const CLIMB_COST = 0.3;

const resolved = (t: Tally | undefined) => (t ? t.value.filter((v) => v !== undefined).length : 0);

/**
 * 進み具合(0〜1)。各段階に見込みの計算量(シナリオを最後まで調べる回数)で持ち分を割り振り、段階の中は片付いた割合で進める:
 *   seeds   出発点の数 × シナリオ数。片付いたシナリオの割合
 *   climb   予算(maxDecks)× シナリオ数 × CLIMB_COST。片付いたデッキ(打ち切りを含む)の数 ÷ 予算
 *   refine  keep × 測り直しのシナリオ数。片付いたシナリオの割合
 *   certify keep × 2(先攻/後攻)。済んだ上位集合の探りの割合
 * 段階が早く終わった時(全勝のデッキが見つかった、行き止まり、測り直しが要らない)は、残りの持ち分を飛ばして先へ進む。
 * 後戻りはせず、完了した時だけ 1 になる。
 */
export function deckSearchRatio(s: DeckSearch): number {
  if (s.phase === 'done') return 1;
  const o = s.options;
  const n = s.scenarios.length;
  const share: Record<Exclude<SearchPhase, 'done'>, number> = {
    seeds: s.seeds.length * n,
    climb: o.climb && o.maxDecks > 0 ? o.maxDecks * n * CLIMB_COST : 0,
    refine: s.refineScenarios ? o.keep * s.refineScenarios.length : 0,
    certify: s.supersetOk ? o.keep * 2 : 0,
  };
  const phases = ['seeds', 'climb', 'refine', 'certify'] as const;
  const total = phases.reduce((a, p) => a + share[p], 0);
  if (total === 0) return 0;
  let passed = 0;
  for (const p of phases) {
    if (p === s.phase) break;
    passed += share[p];
  }
  return (passed + share[s.phase] * phaseFraction(s)) / total;
}

/** 今の段階の中での進み具合(0〜1) */
function phaseFraction(s: DeckSearch): number {
  const g = s.generation;
  const n = s.scenarios.length;
  const ratio = (done: number, all: number) => (all === 0 ? 1 : done / all);
  switch (s.phase) {
    case 'seeds':
      return ratio(g.decks.reduce((a, k) => a + resolved(s.evals[k].tally), 0), g.decks.length * n);
    case 'climb': {
      // 打ち切ったデッキは片付いた 1 個、調べている途中のデッキは片付いたシナリオの割合で数える。
      // 最後の世代は予算を少し超えることがあるので、超えた分は数えない(1 で止める)
      const current = g.decks.reduce((a, k) => a + (s.evals[k].pruned ? 1 : ratio(resolved(s.evals[k].tally), n)), 0);
      return Math.min(1, (s.climbDecks + current) / s.options.maxDecks);
    }
    case 'refine':
      return ratio(g.decks.reduce((a, k) => a + resolved(s.evals[k].refined), 0), g.decks.length * (s.refineScenarios?.length ?? 0));
    case 'certify': {
      let done = 0;
      let all = 0;
      for (const k of g.decks) {
        const e = s.evals[k];
        const d = Object.keys(e.superset).length;
        done += d;
        all += d + supersetTasks(s, e).length;
      }
      return ratio(done, all);
    }
    default:
      return 1;
  }
}

/** 見つかった中で良い順。測り直したデッキ同士は測り直した点で、それ以外は探索中の点で比べる */
export function topDecks(s: DeckSearch, n = s.options.keep): DeckEval[] {
  const refined = (e: DeckEval) => e.refined !== undefined && isComplete(s, e, 'refine');
  return Object.values(s.evals)
    .filter((e) => !e.pruned && isComplete(s, e))
    .sort((a, b) =>
      Number(refined(b)) - Number(refined(a)) ||
      compareScores(refined(a) && refined(b) ? deckScore(s, b) : searchScore(s, b), refined(a) && refined(b) ? deckScore(s, a) : searchScore(s, a)) ||
      (a.key < b.key ? -1 : 1),
    )
    .slice(0, n);
}

/** ワーカーなしで最後まで進める(テスト用)。batch は同時に配るタスク数、pick は結果を反映する順を決める */
export function runDeckSearchSync(
  ctx: DeckContext,
  start: DeckSearch,
  run: (t: DeckTask) => DeckTaskResult = (t) => runDeckTask(ctx, t),
  batch = 1,
  pick: (n: number) => number = () => 0,
): DeckSearch {
  let s = start;
  for (;;) {
    const tasks = nextDeckTasks(s, batch);
    if (tasks.length === 0) return s;
    s = markDeckIssued(s, tasks);
    const results = tasks.map(run);
    while (results.length > 0) s = applyDeckResult(s, results.splice(pick(results.length), 1)[0]);
  }
}

export interface PrepareInput {
  matchup: Matchup;
  /**
   * evaluate: decks をそのまま評価するだけ(手持ちやデッキの制限は見ない)
   * search: owned から探す。decks は出発点に加える利用者のデッキ(全て手持ちにあり、合法なものだけ使う)
   */
  mode: 'evaluate' | 'search';
  owned: readonly DeckCard[];
  decks: readonly DeckCard[][];
  options?: Partial<DeckSearchOptions>;
  pool?: PoolOptions;
  /** 相手の候補が足りない分を想定から引く関数(matchup.oppPrior がある時は必須。handPrior.ts の makeHandSampler) */
  fill?: HandFill;
  /** false なら、上位のデッキをより大きいシナリオで測り直す段階(refine)を省く(ドラフトの 3 通りの比較など、速さを優先する時) */
  refine?: boolean;
}

export interface PreparedSearch {
  context: DeckContext;
  search: DeckSearch;
  kind: DeckEvalKind;
}

/** 利用者のデッキを出発点に使えない理由。両方空なら使える */
export interface SeedCheck {
  problems: DeckProblem[];
  /** 手持ちに無いカード(手入力で ID が負のものも含む) */
  missing: DeckCard[];
}

/**
 * 利用者のデッキ(今の手札、保存デッキ)を出発点に使えるか。合法で、全て手持ちにあるものだけ使う
 * (手持ちに無いカードで探索を進めると、提案が手持ちの外に出る)。使えない時は UI がここの理由を表示する。
 */
export function checkSeed(deck: readonly DeckCard[], ownedIds: ReadonlySet<number>): SeedCheck {
  return { problems: deckProblems(deck), missing: deck.filter((c) => !ownedIds.has(c.id)) };
}

export const seedUsable = (check: SeedCheck): boolean => check.problems.length === 0 && check.missing.length === 0;

/** 相手の具体的な手札を全て並べる上限(学習済みのカードで候補が増えた NPC 向け。PlayScreen と同じ値) */
const MAX_HANDS = 30;

/**
 * 対戦条件から、シナリオ・候補・出発点を作って探索の初期状態を返す。
 * シナリオの乱数は対戦条件のキーから作るので、同じ条件なら何度やっても同じシナリオ、同じ結果になる。
 */
export function prepareDeckSearch(input: PrepareInput): PreparedSearch {
  const m = input.matchup;
  const key = matchupKey(m);
  const budget = scenarioBudget(m);
  const set = makeScenarios(m, { rng: makeRng(hashSeed(key)), maxScenarios: budget.search, maxHands: MAX_HANDS, fill: input.fill });
  const refineSet = set.enumerated || input.refine === false ? null : makeScenarios(m, { rng: makeRng(hashSeed(`${key}#refine`)), maxScenarios: budget.refine, maxHands: MAX_HANDS, fill: input.fill });
  // 並び順が結果に関係するのはオーダーだけ(カオスでは出る順がランダムなので、デッキの並びは関係しない)
  const ordered = set.variants.some((v) => v.rules.pick === 'order');
  const searching = input.mode === 'search';
  const pools = searching ? buildPools(input.owned, m, input.pool) : null;
  const ownedIds = new Set(input.owned.map((c) => c.id));
  const mine = input.decks.filter((d) => seedUsable(checkSeed(d, ownedIds)));
  const seeds = pools ? seedDecks(pools, m, mine) : input.decks.map((d) => [...d]);
  const search = createDeckSearch({
    key: `${key}#${input.mode}`,
    ordered,
    set,
    refineSet,
    supersetOk: supersetApplicable(m),
    pools,
    seeds,
    options: { ...DEFAULT_SEARCH_OPTIONS, ...input.options, climb: searching && (input.options?.climb ?? true) },
  });
  return { context: { matchup: m, set, refineSet }, search, kind: deckEvalKind(m, set) };
}
