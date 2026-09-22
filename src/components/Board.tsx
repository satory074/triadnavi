import { CELL_NAMES } from '../core/geometry';
import type { MatchView } from '../core/match';
import type { Flip } from '../core/refEngine';
import { CardView } from './CardView';

interface Props {
  view: MatchView;
  shiftOf: (cardIndex: number) => number;
  recommendedCell: number | null;
  canPlace: boolean;
  onCell: (cell: number) => void;
}

const CAUSE_LABEL: Record<Flip['cause'], string> = { basic: '', same: 'セイム', plus: 'プラス', combo: 'コンボ' };

export function Board({ view, shiftOf, recommendedCell, canPlace, onCell }: Props) {
  return (
    <div className="board" role="grid" aria-label="盤面">
      {view.state.board.map((c, cell) => {
        if (!c) {
          return (
            <button
              type="button"
              key={cell}
              className={`cell cell-empty${recommendedCell === cell ? ' is-recommended' : ''}${canPlace ? ' cell-open' : ''}`}
              disabled={!canPlace}
              onClick={() => onCell(cell)}
              aria-label={`${CELL_NAMES[cell]}に置く`}
            />
          );
        }
        const flip = view.lastFlips.find((f) => f.cell === cell);
        const badge = flip ? CAUSE_LABEL[flip.cause] + (flip.cause === 'combo' && flip.gen > 1 ? ` ${flip.gen}` : '') : undefined;
        return (
          <div key={cell} className={`cell${view.lastCell === cell ? ' cell-last' : ''}${flip ? ' cell-flipped' : ''}`}>
            <CardView
              card={view.cards[c.card]}
              owner={c.owner}
              shift={shiftOf(c.card)}
              badge={badge || undefined}
              ariaLabel={`${CELL_NAMES[cell]}: ${c.owner === 0 ? '自分' : '相手'}のカード`}
            />
          </div>
        );
      })}
    </div>
  );
}
