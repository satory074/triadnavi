import { variantLabel, type DeckEvalKind, type Matchup, type ScenarioSet } from './deckEval';
import { deckScore, isComplete, type DeckEval, type DeckSearch, type StopReason } from './deckSearch';
import { percent } from './rank';

/** デッキの評価と提案の、日本語の表示。「確定」「保証」「推定」の言葉の使い分けは core/rank.ts と揃える */

export const DECK_KIND_LABEL: Record<DeckEvalKind, string> = { exact: '確定', estimate: '推定', chaos: 'カオス: 推定' };

export function deckKindNote(kind: DeckEvalKind): string {
  if (kind === 'exact') return '対戦が始まった時に見えている情報だけで、最後まで読み切った結果です。';
  if (kind === 'chaos') return 'カオスでは出るカードが毎回ランダムに決まります。出る順を何通りも想定して解いた目安で、結果を保証するものではありません。';
  return '相手の裏向きの手札(や並び順)を知っている前提で解いた、楽観側の目安です。';
}

/** どんな状況を想定したか */
export function scenarioSummary(m: Matchup, set: ScenarioSet): string {
  const n = set.scenarios.length;
  const parts: string[] = [];
  if (set.variants.length > 1) parts.push('ルーレットの結果');
  parts.push(set.handCount > 1 ? `相手の手札 ${set.handCount} 通り` : m.oppUnknown > 0 && set.handCount === 0 ? '相手の手札' : '');
  parts.push('先攻/後攻');
  if (set.variants.some((v) => v.swap)) parts.push('スワップで交換されるカード');
  if (set.variants.some((v) => v.rules.pick === 'order')) parts.push('相手の並び順');
  if (set.variants.some((v) => v.rules.pick === 'chaos')) parts.push('カードの出る順');
  const what = parts.filter(Boolean).join(' × ');
  return set.enumerated ? `${what} の全 ${n} 通りを調べます。` : `${what} の組み合わせから ${n} 通りを選んで調べます(上位のデッキは、通り数を増やして測り直します)。`;
}

export interface DeckLine {
  text: string;
  tone: 'win' | 'draw' | 'loss' | 'plain';
}

const uniform = (weights: readonly number[]) => weights.every((w) => Math.abs(w - weights[0]) < 1e-9);

/** デッキ 1 つの結果の説明 */
export function deckLines(s: DeckSearch, e: DeckEval): DeckLine[] {
  const refined = e.refined !== undefined && isComplete(s, e, 'refine');
  const scenarios = refined ? s.refineScenarios! : s.scenarios;
  const values = (refined ? e.refined! : e.tally).value;
  const score = deckScore(s, e);
  const n = scenarios.length;
  const out: DeckLine[] = [];
  const count = (pred: (v: number) => boolean) => values.filter((v) => v !== undefined && pred(v)).length;
  const wins = count((v) => v >= 1);
  const draws = count((v) => v === 0);
  const asCount = uniform(scenarios.map((x) => x.weight));
  const share = (k: number, p: number) => (asCount ? `${n} 通りのうち ${k} 通り` : `${percent(p)}`);

  if (wins === n) out.push({ text: `想定した ${n} 通りの全てで、最善を尽くせば勝ちが確定します。`, tone: 'win' });
  else {
    out.push({ text: `勝ちが確定: ${share(wins, score.win)}`, tone: wins > 0 ? 'win' : 'plain' });
    out.push({ text: `引き分け以上が確定: ${share(wins + draws, score.drawOrBetter)}`, tone: wins + draws > 0 ? 'draw' : 'plain' });
    const lossShare = 1 - score.drawOrBetter;
    if (lossShare > 1e-9) out.push({ text: `残りは相手が最善を尽くすと負け(平均 ${(score.deficit / lossShare).toFixed(1)} 枚差)`, tone: 'loss' });
  }
  for (const first of [0, 1] as const) {
    const r = e.superset[first];
    if (r === 'win' || r === 'draw') {
      out.push({
        text: `保証: ${first === 0 ? '先攻' : '後攻'}なら、相手が候補のどのカードを持っていても${r === 'win' ? '勝ち' : '引き分け以上'}が確定します。`,
        tone: r,
      });
    }
  }
  return out;
}

export interface VariantRow {
  label: string;
  share: number;
  win: number;
  drawOrBetter: number;
}

/** ルーレットの結果ごとの内訳。ルーレットが無ければ空 */
export function variantRows(s: DeckSearch, e: DeckEval, search: ScenarioSet, refine: ScenarioSet | null): VariantRow[] {
  const refined = refine !== null && e.refined !== undefined && isComplete(s, e, 'refine');
  const set = refined ? refine : search;
  const values = (refined ? e.refined! : e.tally).value;
  if (set.variants.length <= 1) return [];
  return set.variants.map((v, vi) => {
    const idx = set.scenarios.map((sc, i) => (sc.variant === vi ? i : -1)).filter((i) => i >= 0);
    const total = idx.reduce((a, i) => a + set.scenarios[i].weight, 0);
    const sum = (pred: (x: number) => boolean) => idx.reduce((a, i) => a + (pred(values[i] ?? -9) ? set.scenarios[i].weight : 0), 0);
    return { label: variantLabel(v), share: v.share, win: total > 0 ? sum((x) => x >= 1) / total : 0, drawOrBetter: total > 0 ? sum((x) => x >= 0) / total : 0 };
  });
}

export function stopReasonText(reason: StopReason | undefined): string {
  switch (reason) {
    case 'perfect': return '全ての状況で勝ちが確定するデッキが見つかったので、探索を終えました。';
    case 'exhausted': return '候補のカードとの 1 枚の入れ替えでは、これ以上良くなりません。見つかった中で最良のデッキです(全てのデッキを調べたわけではありません)。';
    case 'budget': return '調べるデッキ数の上限に達しました。見つかった中で最良のデッキです。';
    default: return '';
  }
}

/** 評価に反映していない/仮定していることの注意書き */
export function matchupCautions(m: Matchup, usesRegional: boolean): string[] {
  const out: string[] = [];
  if (m.roulette > 0) {
    out.push('ルーレット: 対戦が始まってから加わるルールを、どれも同じ確率で出るものとして平均しています(実機で未確認の仮定)。ランダムハンドが出た時は手持ちから手札が選ばれ、デッキは関係なくなるので、評価から外しています。');
  }
  if (m.swap) out.push('スワップ: 交換されるカードは、双方の 5 枚から同じ確率で 1 枚ずつ選ばれるものとしています。');
  if (usesRegional) out.push('流行ルールが適用される NPC です。今日の流行ルールも「この対戦のルール」で選んでから評価してください(ランダムハンドやドラフトの日は、デッキの選択は結果に関係しません)。');
  out.push('NPC は最善手を打つとは限りません。ここでの結果は相手が最善を尽くした場合のもので、実戦ではナビに従えばこれより良い結果になることが多いはずです。');
  out.push('サドンデスの再戦は含めていません(引き分けは引き分けとして数えます)。');
  return out;
}
