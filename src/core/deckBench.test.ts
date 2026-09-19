import { describe, expect, it } from 'vitest';
import { CARDS, NPCS, npcCards, toCardDef, type CardInfo } from '../data';
import { EMPTY_DRAFT, applyNpc, matchupFromDraft } from './appState';
import { makeScenarios, positionAtLeast, positionValue, scenarioBudget, scenarioPosition, supersetApplicable, supersetPosition, type Matchup } from './deckEval';
import { makeRng } from './rng';

// `npm run bench:deck` で有効化。デッキ 1 つの評価にかかる時間を実在の NPC で測り、探索の規模を決める材料にする
const enabled = Boolean(import.meta.env.VITE_BENCH);

const timed = <T>(f: () => T): { ms: number; value: T } => {
  const t0 = performance.now();
  const value = f();
  return { ms: performance.now() - t0, value };
};
const pct = (xs: number[], p: number) => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]);

const sum = (c: CardInfo) => c.sides.reduce((a, b) => a + b, 0);
const best = (stars: number, n: number, skip = 0, low = false) =>
  CARDS.filter((c) => c.stars === stars).sort((a, b) => (low ? sum(a) - sum(b) : sum(b) - sum(a)) || a.id - b.id).slice(skip, skip + n);

const DECKS: Record<string, CardInfo[]> = {
  '★5+★4+★3': [...best(5, 1), ...best(4, 1), ...best(3, 3)],
  '★3 のみ': best(3, 5, 3),
  '★1 の弱い順': best(1, 5, 0, true),
};

function matchupOf(name: string): Matchup {
  const npc = NPCS.find((n) => n.name === name)!;
  const { fixed, variable } = npcCards(npc);
  const draft = applyNpc(EMPTY_DRAFT, { id: npc.id, fixed: fixed.map(toCardDef), variable: variable.map(toCardDef), rules: npc.rules }, []);
  return matchupFromDraft(draft, npc.rules);
}

const NPC_NAMES = ['メメルン', 'クリントータ', 'ル・アシャ大甲佐', 'ボルセル大牙佐', 'バスカロン', 'コブレヴァ', 'ガヴォージャ', 'イソベ', 'シーサジャ'];

describe.skipIf(!enabled)('ベンチマーク: デッキの評価', () => {
  it('実在の NPC × 代表的なデッキ', () => {
    const allWin: number[] = [];
    const allValue: number[] = [];
    for (const name of NPC_NAMES) {
      const m = matchupOf(name);
      const set = makeScenarios(m, { rng: makeRng(1), maxScenarios: scenarioBudget(m).search, maxHands: 30 });
      for (const [label, cards] of Object.entries(DECKS)) {
        const deck = cards.map(toCardDef);
        const win: number[] = [];
        const value: number[] = [];
        let wins = 0;
        let draws = 0;
        let deficit = 0;
        for (const s of set.scenarios) {
          const pos = scenarioPosition(m, set, s, deck);
          win.push(timed(() => positionAtLeast(pos, 1)).ms);
          const v = timed(() => positionValue(pos));
          value.push(v.ms);
          if (v.value >= 1) wins++;
          else if (v.value === 0) draws++;
          else deficit += -v.value * s.weight;
        }
        allWin.push(...win);
        allValue.push(...value);
        console.log(
          `${name} [${m.ruleIds.join(',')}${m.swap ? ' swap' : ''}${m.roulette ? ' roulette' + m.roulette : ''}] × ${label}: ` +
            `${set.scenarios.length} シナリオ${set.enumerated ? '' : '(サンプル)'} 勝ち ${wins} 分け ${draws} 負けの枚数差 ${deficit.toFixed(2)} | ` +
            `勝ちの探り 中央値 ${pct(win, 0.5).toFixed(0)}ms p90 ${pct(win, 0.9).toFixed(0)}ms | ` +
            `保証値 中央値 ${pct(value, 0.5).toFixed(0)}ms p90 ${pct(value, 0.9).toFixed(0)}ms 最大 ${Math.max(...value).toFixed(0)}ms | ` +
            `デッキ 1 つ(保証値のみ) ${value.reduce((a, b) => a + b, 0).toFixed(0)}ms`,
        );
      }
      if (supersetApplicable(m)) {
        const deck = DECKS['★5+★4+★3'].map(toCardDef);
        for (const first of [0, 1] as const) {
          const t = timed(() => positionAtLeast(supersetPosition(m, deck, first), 1));
          console.log(`  上位集合(${first === 0 ? '先攻' : '後攻'}): ${t.value ? '勝ち' : '勝ちではない'} ${t.ms.toFixed(0)}ms`);
        }
      }
    }
    console.log(
      `全体: 勝ちの探り 中央値 ${pct(allWin, 0.5).toFixed(0)}ms p90 ${pct(allWin, 0.9).toFixed(0)}ms / ` +
        `保証値 中央値 ${pct(allValue, 0.5).toFixed(0)}ms p90 ${pct(allValue, 0.9).toFixed(0)}ms 最大 ${Math.max(...allValue).toFixed(0)}ms`,
    );
    expect(allWin.length).toBeGreaterThan(0);
  }, 3_600_000);
});
