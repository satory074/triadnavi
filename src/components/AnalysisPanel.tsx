import { useState } from 'react';
import { CELL_NAMES } from '../core/geometry';
import { KIND_GLOSS, KIND_LABEL, classLabel, outcomeText, percent, progressPercent, rankedMoves, recommended, secondaryText } from '../core/rank';
import type { Analysis, MoveEval } from '../core/scheduler';
import { formatSides, type CardDef } from '../core/types';
import type { SolverState } from '../hooks/useSolver';

interface Props {
  solver: SolverState;
  cards: readonly CardDef[];
  onApply: (m: MoveEval) => void;
}

const cardName = (c: CardDef) => c.label ?? formatSides(c.sides);

/** 表に最初から出す手の数 */
const TOP_ROWS = 6;

/**
 * おすすめの手。上から「カード → マス」「何が起きるか(結論)」「根拠」「打ったボタン」の順。
 * 計算が終わるまでは暫定で、途中でおすすめが変わることがある(実測: 39% と 100% で別の手)。
 * その間はボタンを枠だけの金にし、「計算中 NN%」を同じ行に出す。Enter は暫定でも効く(ゲームで打った手を記録する操作なので)
 */
export function BestMove({ solver, cards, onApply }: Props) {
  const a = solver.analysis;
  if (solver.error) {
    return (
      <section className="panel best-strip">
        <p className="note note-warn">計算中にエラーが起きました: {solver.error}</p>
      </section>
    );
  }
  if (!a) return null;

  const best = recommended(a);
  const busy = !solver.complete && solver.total > 0;
  const pct = progressPercent(solver.ratio);
  const pess = best?.pessimistic && best.pessimistic !== 'loss'
    ? `どのカードを引かされても${best.pessimistic === 'win' ? '勝ち' : '引き分け以上'}`
    : null;
  const basis = best ? secondaryText(best, a) : '';

  return (
    <section className="panel best-strip" aria-label="おすすめの手">
      {busy && <progress className="best-progress" value={solver.ratio} aria-label="計算の進み具合" />}
      {best ? (
        <>
          <p className="best-move" aria-live="polite" aria-atomic="true">
            <span className="best-card">{cardName(cards[best.move.card])}</span>
            <span className="best-to">を</span>
            <span className="best-cell">{CELL_NAMES[best.move.cell]}</span>
            <span className="best-to">へ</span>
            {busy && <span className="tag tag-busy">計算中 {pct}%</span>}
          </p>
          <p className={`best-outcome${best.cls ? ` cls-${best.cls}` : ''}`}>{outcomeText(best, a)}</p>
          <p className="best-basis">
            <span className="kind">{KIND_LABEL[a.kind]}</span>
            <span className="muted">
              {KIND_GLOSS[a.kind]}
              {basis && `。${basis}`}
            </span>
          </p>
          {pess && <p className="pess">{pess}</p>}
          <button type="button" className={busy ? 'btn btn-provisional' : 'btn btn-primary'} onClick={() => onApply(best)}>
            {busy ? '暫定: この手を打った' : 'おすすめ通りに打った'}
            <kbd className="key-hint">Enter</kbd>
          </button>
          {busy && <p className="progress">より良い手が見つかると、おすすめが変わります</p>}
        </>
      ) : (
        <p className="note">計算を始めています{busy && `(${pct}%)`}</p>
      )}
    </section>
  );
}

/**
 * 他の手の一覧。スマホでは畳み、PC では開いた状態で始める。
 * 数は「勝 / 分 / 負」に揃え、分母は上に 1 回だけ書く。分類のラベルは、おすすめと違う行にだけ出す
 */
export function MoveTable({ solver, cards }: Omit<Props, 'onApply'>) {
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 56rem)').matches);
  const [showAll, setShowAll] = useState(false);
  const a = solver.analysis;
  if (!a || solver.error) return null;
  const best = recommended(a);
  const ranked = rankedMoves(a);
  if (!best || ranked.length < 2) return null;
  const rows = showAll ? ranked : ranked.slice(0, TOP_ROWS);
  const legend = tallyLegend(a, best);
  const withClass = a.kind !== 'estimate' && a.kind !== 'chaos';

  return (
    <details className="panel moves-more" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>他の手を見る({ranked.length - 1})</summary>
      {legend && <p className="note">{legend}</p>}
      <table className="moves">
        <thead>
          <tr><th>カード</th><th>マス</th><th>結果</th></tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={`${m.move.card}.${m.move.cell}`} className={m === best ? 'row-best' : ''}>
              <td>{cardName(cards[m.move.card])}</td>
              <td>{CELL_NAMES[m.move.cell]}</td>
              <td>
                {withClass && m.cls !== best.cls && <span className={`cls cls-${m.cls}`}>{classLabel(m.cls, a.kind)} </span>}
                <span className="tally">{tally(m, a, best)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranked.length > TOP_ROWS && (
        <button type="button" className="btn-tertiary btn-sm" onClick={() => setShowAll(!showAll)}>
          {showAll ? '上位だけ表示' : `全 ${ranked.length} 手を表示`}
        </button>
      )}
    </details>
  );
}

/** 表の数字の読み方(全行に同じ分母を繰り返さない) */
function tallyLegend(a: Analysis, best: MoveEval): string | null {
  if (a.kind === 'chaos') return '勝 / 分 / 負 は、引く順を想定した時の割合です';
  if (best.worlds) return `勝 / 分 / 負 は、${a.worldsEnumerated ? '相手の手札' : '想定した手札'} ${best.worlds.n} 通りのうちの数です`;
  if (best.mistakes) return '数は、相手の応手のうち自分の勝ちが確定する通り数 / 応手の数です';
  return null;
}

/** 1 手ぶんの数字。おすすめと分母が違う行(計算の途中)にだけ、通り数を添える */
function tally(m: MoveEval, a: Analysis, best: MoveEval): string {
  if (a.kind === 'chaos') {
    if (m.chaos) return `${percent(m.chaos.win)} / ${percent(m.chaos.draw)} / ${percent(m.chaos.loss)}`;
    if (m.worlds) return `${percent(m.worlds.win / m.worlds.n)} / ${percent(m.worlds.draw / m.worlds.n)}(${m.worlds.n} 通り)`;
    return '';
  }
  if (m.worlds) {
    const n = best.worlds && best.worlds.n !== m.worlds.n ? `(${m.worlds.n} 通り)` : '';
    return `${m.worlds.win} / ${m.worlds.draw} / ${m.worlds.loss}${n}`;
  }
  if (m.value !== undefined && m.value > 0) return `最終 ${5 + m.value} 対 ${5 - m.value}`;
  if (m.mistakes && m.mistakes.replies > 0) {
    const e = m.mistakes;
    return `${e.toWin} / ${e.replies}${m.cls === 'loss' ? `(引き分け以上 ${e.toDrawOrBetter})` : ''}`;
  }
  return '';
}
