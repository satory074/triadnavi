import type { Analysis, MoveEval } from './scheduler';
import { topClass } from './scheduler';
import type { GuaranteeKind } from './position';
import type { Outcome } from './types';

const CLASS_RANK: Record<string, number> = { win: 3, draw: 2, notWin: 1.5, loss: 1 };

const frac = (num: number, den: number) => (den > 0 ? num / den : -1);

/** 比較キー(大きいほど良い)を順に並べたもの */
function keys(m: MoveEval, kind: GuaranteeKind): number[] {
  if (kind === 'chaos') {
    const exact = m.chaos ? m.chaos.win + 0.5 * m.chaos.draw : -1;
    const est = m.worlds ? frac(m.worlds.win + 0.5 * m.worlds.draw, m.worlds.n) : -1;
    return [exact, est, m.pessimistic ? CLASS_RANK[m.pessimistic] : 0, m.staticScore];
  }
  if (kind === 'estimate') {
    const w = m.worlds;
    return [w ? frac(w.win, w.n) : -1, w ? frac(w.win + w.draw, w.n) : -1, m.staticScore];
  }
  // 保証クラス → 同点の中の指標(世界の勝ち割合 / 相手の応手で勝ちが確定する割合)→ 枚数差 → 静的評価
  const cls = m.cls ? CLASS_RANK[m.cls] : 0;
  const w = m.worlds;
  const e = m.mistakes;
  return [
    cls,
    w ? frac(w.win, w.n) : e ? frac(e.toWin, e.replies) : -1,
    w ? frac(w.win + w.draw, w.n) : e ? frac(e.toDrawOrBetter, e.replies) : -1,
    m.value ?? -99,
    m.staticScore,
  ];
}

/** 良い手が先に来る比較関数 */
export function compareMoves(a: MoveEval, b: MoveEval, kind: GuaranteeKind): number {
  const ka = keys(a, kind);
  const kb = keys(b, kind);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
  return a.move.card - b.move.card || a.move.cell - b.move.cell;
}

export function rankedMoves(a: Analysis): MoveEval[] {
  return [...a.moves].sort((x, y) => compareMoves(x, y, a.kind));
}

function evaluated(m: MoveEval, kind: GuaranteeKind): boolean {
  if (kind === 'chaos') return m.chaos !== undefined || m.worlds !== undefined;
  if (kind === 'estimate') return m.worlds !== undefined;
  return m.cls !== undefined;
}

/** 現時点のおすすめ(まだ 1 手も評価できていなければ null) */
export function recommended(a: Analysis): MoveEval | null {
  const best = rankedMoves(a).find((m) => evaluated(m, a.kind));
  return best ?? null;
}

export const KIND_LABEL: Record<GuaranteeKind, string> = {
  exact: '確定',
  pool: '保証',
  estimate: '推定',
  chaos: 'カオス',
};

export function classLabel(cls: Outcome | 'notWin' | undefined, kind: GuaranteeKind): string {
  if (cls === undefined) return '計算中';
  if (kind === 'pool') {
    return { win: '勝ち保証', draw: '引き分け以上を保証', notWin: '勝ちの保証なし', loss: '保証なし' }[cls];
  }
  return { win: '勝ち確定', draw: '引き分け以上', notWin: '勝ち確定ではない', loss: '相手が最善なら負け' }[cls];
}

/** 局面全体の見出し */
export function headline(a: Analysis): string {
  if (a.kind === 'estimate') return '相手の手札が不明のため、推定のみ';
  if (a.kind === 'chaos') return a.chaosExact ? 'カオス: 厳密な勝率' : 'カオス: 勝率の推定';
  const top = topClass(a);
  if (top === undefined) return '計算中';
  if (a.kind === 'pool') {
    return {
      win: '相手が候補のどのカードを持っていても勝てます',
      draw: '相手が候補のどのカードを持っていても引き分け以上です',
      loss: '最悪の手札に対する保証はありません(下の割合を参考に)',
    }[top];
  }
  return {
    win: '最善を尽くせば勝ちが確定しています',
    draw: '最善を尽くせば引き分け以上。相手のミスを待ちます',
    loss: '相手が最善なら負け。相手のミスを最大限狙います',
  }[top];
}

export function percent(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** 各手に添える副指標の文言(各手に出す数字は、保証クラスとこれの 2 つまで) */
export function secondaryText(m: MoveEval, a: Analysis): string {
  if (a.kind === 'chaos') {
    if (m.chaos) return `勝ち ${percent(m.chaos.win)}、引き分け ${percent(m.chaos.draw)}、負け ${percent(m.chaos.loss)}`;
    if (m.worlds) return `勝ち ${percent(m.worlds.win / m.worlds.n)}、引き分け ${percent(m.worlds.draw / m.worlds.n)}(${m.worlds.n} 通りの引き順で試算)`;
    return '';
  }
  if (m.worlds) {
    const head = a.worldsEnumerated ? `相手の手札 ${m.worlds.n} 通りのうち` : `想定した手札 ${m.worlds.n} 通りのうち`;
    return `${head} 勝ち ${m.worlds.win}、引き分け ${m.worlds.draw}、負け ${m.worlds.loss}`;
  }
  if (m.value !== undefined && m.value > 0) return `最終 ${5 + m.value} 対 ${5 - m.value}`;
  if (m.mistakes && m.mistakes.replies > 0) {
    const e = m.mistakes;
    const draw = m.cls === 'loss' ? `、${e.toDrawOrBetter} 通りで引き分け以上` : '';
    return `相手の応手 ${e.replies} 通りのうち ${e.toWin} 通りで勝ちが確定${draw}`;
  }
  return '';
}
