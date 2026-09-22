import { useState } from 'react';
import { CELL_NAMES } from '../core/geometry';
import { KIND_LABEL, classLabel, headline, rankedMoves, recommended, secondaryText } from '../core/rank';
import type { MoveEval } from '../core/scheduler';
import { formatSides, type CardDef } from '../core/types';
import type { SolverState } from '../hooks/useSolver';

interface Props {
  solver: SolverState;
  cards: readonly CardDef[];
  onApply: (m: MoveEval) => void;
}

const cardName = (c: CardDef) => c.label ?? formatSides(c.sides);

export function AnalysisPanel({ solver, cards, onApply }: Props) {
  const [showAll, setShowAll] = useState(false);
  const a = solver.analysis;
  if (solver.error) return <section className="panel"><p className="note note-warn">計算中にエラーが起きました: {solver.error}</p></section>;
  if (!a) return null;

  const best = recommended(a);
  const ranked = rankedMoves(a);
  const rows = showAll ? ranked : ranked.slice(0, 6);
  const pess = best?.pessimistic && best.pessimistic !== 'loss'
    ? `どのカードを引かされても${best.pessimistic === 'win' ? '勝ち' : '引き分け以上'}`
    : null;

  return (
    <section className="panel analysis" aria-live="polite">
      <div className="analysis-head">
        <span className={`kind kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
        <p className="headline">{headline(a)}</p>
      </div>

      {best ? (
        <div className="best">
          <p className="best-move">
            <span className="best-card">{cardName(cards[best.move.card])}</span>
            <span className="best-to">を</span>
            <span className="best-cell">{CELL_NAMES[best.move.cell]}</span>
            <span className="best-to">へ</span>
          </p>
          <p className="best-detail">
            {a.kind !== 'estimate' && a.kind !== 'chaos' && <span className={`cls cls-${best.cls}`}>{classLabel(best.cls, a.kind)}</span>}
            <span>{secondaryText(best, a)}</span>
          </p>
          {pess && <p className="pess">{pess}</p>}
          <button type="button" className="btn btn-primary" onClick={() => onApply(best)}>
            おすすめ通りに打った<kbd className="key-hint">Enter</kbd>
          </button>
        </div>
      ) : (
        <p className="note">計算を始めています</p>
      )}

      {!solver.complete && solver.total > 0 && (
        <p className="progress">
          <progress value={solver.done} max={solver.total} /> 計算中 {solver.done} / {solver.total}(おすすめは、より良い手が見つかった時だけ変わります)
        </p>
      )}

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
                {a.kind !== 'estimate' && a.kind !== 'chaos' && <span className={`cls cls-${m.cls}`}>{classLabel(m.cls, a.kind)}</span>}
                <span className="muted"> {secondaryText(m, a)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {ranked.length > 6 && (
        <button type="button" className="btn-quiet" onClick={() => setShowAll(!showAll)}>
          {showAll ? '上位だけ表示' : `全 ${ranked.length} 手を表示`}
        </button>
      )}
    </section>
  );
}
