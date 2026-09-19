import { describe, expect, it } from 'vitest';
import { isLegalDeck, type DeckCard } from './collection';
import { makeScenarios, positionValue, scenarioPosition, type DeckContext, type DeckTask, type DeckTaskResult, type Matchup } from './deckEval';
import { buildPools, deckKey, neighbours, seedDecks } from './deckPool';
import {
  DEFAULT_SEARCH_OPTIONS, compareScores, createDeckSearch, deckScore, deckSearchProgress, isComplete, nextDeckTasks, runDeckSearchSync, topDecks,
  type DeckSearch, type DeckSearchOptions,
} from './deckSearch';
import { makeRng, type Rng } from './rng';
import type { CardDef, CardType, Sides } from './types';

const card = (sides: number[], type: CardType = 0): CardDef => ({ sides: sides as unknown as Sides, type });

function collection(r: Rng, n: number): DeckCard[] {
  return Array.from({ length: n }, (_, i) => {
    const stars = 1 + Math.floor(r() * 5);
    const v = () => Math.max(1, Math.min(10, stars + 1 + Math.floor(r() * 5)));
    return { id: i + 1, stars, sides: [v(), v(), v(), v()] as unknown as Sides, type: 0 as CardType };
  });
}

function matchup(r: Rng, over: Partial<Matchup> = {}): Matchup {
  const v = () => 1 + Math.floor(r() * 10);
  const cards = (n: number) => Array.from({ length: n }, () => card([v(), v(), v(), v()]));
  return { ruleIds: [], options: { fallenAceInCombo: true }, oppKnown: cards(3), oppPool: cards(4), oppUnknown: 2, roulette: 0, swap: false, ...over };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * エンジンの代わりの評価。デッキの数字の合計が大きいほど勝ちやすく、シナリオごとに難しさが違う。
 * 値はデッキとシナリオだけで決まるので、探索の進み方(配る数、届く順)を変えても同じ答えになるはず。
 * 既定の bias は、強いデッキでも勝ちと負けが混ざる強さ。大きくすると全勝、小さくすると全敗になる。
 */
function synthetic(bias = -40): (t: DeckTask) => DeckTaskResult {
  const valueOf = (t: DeckTask & { kind: 'scenario' }) => {
    const total = t.deck.reduce((a, c) => a + c.sides.reduce((x, y) => x + y, 0), 0);
    const noise = (hash(`${deckKey(t.deck, true)}#${t.set}${t.scenario}`) % 7) - 3;
    const difficulty = (t.scenario * 5) % 11;
    return Math.max(-5, Math.min(1, Math.floor((total - 118 + bias - difficulty * 2 + noise) / 4)));
  };
  return (t) => {
    if (t.kind === 'superset') return { id: t.id, kind: 'superset', deckKey: t.deckKey, first: t.first, mode: t.mode, ok: hash(t.id) % 2 === 0 };
    const base = { id: t.id, kind: 'scenario', deckKey: t.deckKey, set: t.set, scenario: t.scenario } as const;
    if (t.mode === 'value') return { ...base, mode: 'value', value: valueOf(t) };
    return { ...base, mode: t.mode, ok: valueOf(t) >= (t.mode === 'win' ? 1 : 0) };
  };
}

interface Fixture {
  ctx: DeckContext;
  owned: DeckCard[];
  start: (options?: Partial<DeckSearchOptions>, extra?: DeckCard[][]) => DeckSearch;
}

function fixture(seed: number, over: Partial<Matchup> = {}, refine = false, ordered = false): Fixture {
  const r = makeRng(seed);
  const owned = collection(r, 120);
  const m = matchup(r, over);
  const set = makeScenarios(m, { rng: makeRng(1), maxScenarios: 12, maxHands: 30 });
  const refineSet = refine ? makeScenarios(m, { rng: makeRng(2), maxScenarios: 30, maxHands: 30 }) : null;
  const pools = buildPools(owned, m, { perFive: 4, perFour: 4, low: 8, special: 0 });
  return {
    ctx: { matchup: m, set, refineSet },
    owned,
    start: (options = {}, extra = []) =>
      createDeckSearch({
        key: 'test', ordered, set, refineSet, supersetOk: true, pools, seeds: seedDecks(pools, m, extra),
        options: { ...DEFAULT_SEARCH_OPTIONS, generationSize: 6, maxDecks: 400, ...options },
      }),
  };
}

const summary = (s: DeckSearch) => ({
  phase: s.phase,
  stop: s.stopReason,
  top: topDecks(s).map((e) => [e.key, deckScore(s, e), e.superset]),
  evaluated: Object.values(s.evals).filter((e) => !e.pruned).map((e) => e.key).sort(),
});

describe('デッキの探索', () => {
  it('タスクを何個同時に配っても、結果の届く順が違っても、同じデッキと同じ評価に行き着く', () => {
    for (const seed of [1, 2, 3]) {
      const f = fixture(seed);
      const base = summary(runDeckSearchSync(f.ctx, f.start(), synthetic()));
      expect(base.phase).toBe('done');
      for (const batch of [2, 4, 9]) {
        const r = makeRng(seed * 100 + batch);
        const other = runDeckSearchSync(f.ctx, f.start(), synthetic(), batch, (n) => Math.floor(r() * n));
        expect(summary(other), `seed=${seed} batch=${batch}`).toEqual(base);
      }
    }
  });

  it('提案は常に合法で、手持ちだけからなる', () => {
    const f = fixture(4);
    const s = runDeckSearchSync(f.ctx, f.start(), synthetic());
    for (const e of topDecks(s, 10)) {
      expect(isLegalDeck(e.cards)).toBe(true);
      expect(e.cards.every((c) => f.owned.includes(c))).toBe(true);
    }
  });

  it('どの出発点よりも悪くならない', () => {
    for (const seed of [5, 6, 7]) {
      const f = fixture(seed);
      const s = runDeckSearchSync(f.ctx, f.start(), synthetic());
      const best = deckScore(s, topDecks(s, 1)[0]);
      for (const key of s.seeds) expect(compareScores(best, deckScore(s, s.evals[key]))).toBeGreaterThanOrEqual(0);
    }
  });

  it('探索し尽くして終わった時は、1 枚の入れ替えで良くなるデッキが候補の中に無い', () => {
    const f = fixture(8);
    const s = runDeckSearchSync(f.ctx, f.start({ restarts: 0 }), synthetic());
    expect(s.stopReason).toBe('exhausted');
    const run = synthetic();
    const best = s.evals[s.current!];
    const bestScore = deckScore(s, best);
    for (const d of neighbours(best.cards, s.pools!, false)) {
      // 打ち切ったデッキも含めて、全シナリオを評価し直して確かめる
      const values = f.ctx.set.scenarios.map((_, i) => {
        const res = run({ id: 'x', kind: 'scenario', deckKey: 'x', deck: d, set: 'search', scenario: i, mode: 'value' });
        return res.kind === 'scenario' && res.mode === 'value' ? res.value : 0;
      });
      const score = {
        win: f.ctx.set.scenarios.reduce((a, sc, i) => a + (values[i] >= 1 ? sc.weight : 0), 0),
        drawOrBetter: f.ctx.set.scenarios.reduce((a, sc, i) => a + (values[i] >= 0 ? sc.weight : 0), 0),
        deficit: f.ctx.set.scenarios.reduce((a, sc, i) => a + (values[i] < 0 ? -values[i] * sc.weight : 0), 0),
        heuristic: d.reduce((a, c) => a + s.pools!.score[c.id], 0),
      };
      expect(compareScores(score, bestScore), deckKey(d, false)).toBeLessThanOrEqual(0);
    }
  });

  it('今のデッキの勝ちが多い時は、候補の多くを全シナリオを調べる前に打ち切る(打ち切りの正しさは上の検証に含まれる)', () => {
    const f = fixture(9);
    const s = runDeckSearchSync(f.ctx, f.start(), synthetic(-20));
    const p = deckSearchProgress(s);
    expect(deckScore(s, topDecks(s, 1)[0]).win).toBeGreaterThan(0.5);
    expect(p.decksPruned).toBeGreaterThan(p.decksDone);
    expect(p.complete).toBe(true);
    expect(s.probes).toBeLessThan(Object.keys(s.evals).length * f.ctx.set.scenarios.length * 0.7);
  });

  it('全てのシナリオで勝てるデッキが見つかったら、そこで止まる', () => {
    const f = fixture(10);
    const s = runDeckSearchSync(f.ctx, f.start(), synthetic(60));
    expect(s.stopReason).toBe('perfect');
    expect(deckScore(s, topDecks(s, 1)[0]).win).toBeCloseTo(1);
    // 出発点だけで満点なので、1 手先は調べていない
    expect(Object.keys(s.evals).length).toBe(s.seeds.length);
  });

  it('予算(調べるデッキ数)を使い切ったら止まり、その時点の最良が残る', () => {
    const f = fixture(11);
    const s = runDeckSearchSync(f.ctx, f.start({ maxDecks: 12 }), synthetic());
    expect(s.stopReason).toBe('budget');
    expect(s.climbDecks).toBeGreaterThanOrEqual(12);
    expect(s.climbDecks).toBeLessThan(12 + 6);
    expect(topDecks(s).length).toBeGreaterThan(0);
  });

  it('climb を切ると、渡したデッキを評価するだけで終わる(今のデッキの評価)', () => {
    const f = fixture(12);
    const mine = f.owned.filter((c) => c.stars <= 3).slice(0, 5);
    const s0 = createDeckSearch({
      key: 'eval', ordered: false, set: f.ctx.set, refineSet: null, supersetOk: false, pools: null, seeds: [mine],
      options: { ...DEFAULT_SEARCH_OPTIONS, climb: false },
    });
    const s = runDeckSearchSync(f.ctx, s0, synthetic());
    expect(s).toMatchObject({ phase: 'done', stopReason: 'evaluated' });
    expect(Object.keys(s.evals)).toEqual([deckKey(mine, false)]);
    expect(isComplete(s, s.evals[deckKey(mine, false)])).toBe(true);
    // シナリオごとに、勝ち → 引き分け → 負けの深さ、の決まった所まで
    const stages = s.evals[deckKey(mine, false)].tally.value.map((v) => (v! >= 1 ? 1 : v === 0 ? 2 : 3));
    expect(s.probes).toBe(stages.reduce((a, b) => a + b, 0));
  });

  it('サンプリングで探索した時は、上位のデッキだけを大きいシナリオで測り直す', () => {
    const f = fixture(13, { swap: true }, true);
    expect(f.ctx.set.enumerated).toBe(false);
    const s = runDeckSearchSync(f.ctx, f.start({ keep: 2 }), synthetic());
    const refined = Object.values(s.evals).filter((e) => e.refined !== undefined);
    expect(refined.length).toBe(2);
    for (const e of refined) expect(isComplete(s, e, 'refine')).toBe(true);
    expect(topDecks(s, 2).map((e) => e.key).sort()).toEqual(refined.map((e) => e.key).sort());
    expect(refined[0].refined!.value.length).toBe(f.ctx.refineSet!.scenarios.length);
  });

  it('保証の確認は、先攻/後攻のシナリオが全て勝ち(または引き分け以上)のデッキにだけ行う', () => {
    const f = fixture(14);
    const s = runDeckSearchSync(f.ctx, f.start(), synthetic(60));
    const best = topDecks(s, 1)[0];
    expect(Object.keys(best.superset).sort()).toEqual(['0', '1']);

    const weak = runDeckSearchSync(f.ctx, f.start({ maxDecks: 6 }), synthetic(-200));
    expect(Object.values(weak.evals).every((e) => Object.keys(e.superset).length === 0)).toBe(true);
  });

  it('並び順が関係する時は、同じ 5 枚の別の並びを別のデッキとして調べる', () => {
    const f = fixture(15, { ruleIds: [8] }, false, true);
    const s = runDeckSearchSync(f.ctx, f.start({ maxDecks: 30 }), synthetic());
    const sets = Object.values(s.evals).map((e) => deckKey(e.cards, false));
    expect(new Set(sets).size).toBeLessThan(sets.length);
  });

  it('本物のエンジンで最後まで進み、提案の点は各シナリオを解き直した結果と一致する(オーダーで探索を軽くする)', () => {
    const r = makeRng(17);
    const owned = collection(r, 40);
    const m = matchup(r, { ruleIds: [8, 6] });
    const set = makeScenarios(m, { rng: makeRng(1), maxScenarios: 8, maxHands: 30 });
    const pools = buildPools(owned, m, { perFive: 3, perFour: 3, low: 6, special: 2 });
    const ctx: DeckContext = { matchup: m, set, refineSet: null };
    const start = createDeckSearch({
      key: 'real', ordered: true, set, refineSet: null, supersetOk: false, pools, seeds: seedDecks(pools, m, []),
      options: { ...DEFAULT_SEARCH_OPTIONS, generationSize: 8, maxDecks: 40, restarts: 0 },
    });
    const s = runDeckSearchSync(ctx, start);
    expect(s.phase).toBe('done');
    const best = topDecks(s, 1)[0];
    expect(isLegalDeck(best.cards)).toBe(true);
    const values = set.scenarios.map((sc) => positionValue(scenarioPosition(m, set, sc, best.cards)));
    expect(best.tally.value).toEqual(values);
    expect(deckScore(s, best).win).toBeCloseTo(set.scenarios.reduce((a, sc, i) => a + (values[i] >= 1 ? sc.weight : 0), 0));
  }, 60_000);

  it('出発点が無ければ、何もせず終わる', () => {
    const f = fixture(16);
    const s = createDeckSearch({ key: 'none', ordered: false, set: f.ctx.set, refineSet: null, supersetOk: true, pools: null, seeds: [], options: DEFAULT_SEARCH_OPTIONS });
    expect(s.phase).toBe('done');
    expect(nextDeckTasks(s, 4)).toEqual([]);
    expect(topDecks(s)).toEqual([]);
  });
});
