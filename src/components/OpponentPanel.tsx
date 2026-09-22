import type { SetupDraft } from '../core/appState';
import { CardView } from './CardView';

interface Props {
  draft: SetupDraft;
  orderActive: boolean;
  onEditSlot: (slot: number) => void;
  onClearSlot: (slot: number) => void;
  onReveal: (poolIndex: number) => void;
  onAddCandidate: () => void;
  onRemoveCandidate: (poolIndex: number) => void;
  onPriorLevel: (level: 1 | 2 | 3) => void;
  onOrderKnown: (known: boolean) => void;
}

const LEVELS: { level: 1 | 2 | 3; label: string }[] = [
  { level: 1, label: '弱め' },
  { level: 2, label: '標準' },
  { level: 3, label: '強い' },
];

export function OpponentPanel({ draft, orderActive, onEditSlot, onClearSlot, onReveal, onAddCandidate, onRemoveCandidate, onPriorLevel, onOrderKnown }: Props) {
  const unknown = draft.oppCards.filter((c) => c === null).length;
  const hasNpc = draft.npcId !== null;

  return (
    <div className="opp-panel">
      <div className="hand-row">
        {draft.oppCards.map((card, i) => (
          <div className="slot" key={i}>
            <CardView card={card} owner={1} onClick={() => onEditSlot(i)} ariaLabel={card ? `相手の ${i + 1} 枚目を変更` : `相手の ${i + 1} 枚目を入力`} />
            {card ? (
              <button type="button" className="btn-tertiary slot-remove" onClick={() => onClearSlot(i)} aria-label={`相手の ${i + 1} 枚目を外す`}>外す</button>
            ) : (
              <span className="slot-action">入力</span>
            )}
          </div>
        ))}
      </div>
      <p className="note">
        見えているカードだけ入れてください。裏向きのカードは「?」のままで構いません(不明 {unknown} 枚)。
      </p>

      {unknown > 0 && (
        <div className="pool">
          <h3>不明なカードの候補</h3>
          {draft.oppPool.length > 0 ? (
            <>
              <p className="note">{hasNpc ? 'この NPC が残りの枠に入れるカードです。' : ''}見えているカードは、タップで手札へ移せます。</p>
              <div className="pool-row">
                {draft.oppPool.map((card, i) => (
                  <div className="slot" key={i}>
                    <CardView card={card} owner={1} size="sm" showName={false} onClick={() => onReveal(i)} ariaLabel="このカードは手札に見えている" />
                    <span className="pool-name">{card.label ?? ''}</span>
                    {!hasNpc && <button type="button" className="btn-tertiary" onClick={() => onRemoveCandidate(i)}>削除</button>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="note">候補が分かっていれば追加すると、「どのカードを持っていても成り立つ保証」を出せます。</p>
          )}
          <button type="button" className="btn btn-sm" onClick={onAddCandidate}>候補を追加</button>

          {draft.oppPool.length < unknown && (
            <div className="prior">
              <span>候補が足りない分は、相手の強さを想定して推定します</span>
              <div className="segmented" role="group" aria-label="相手の強さの想定">
                {LEVELS.map((l) => (
                  <button type="button" key={l.level} className={draft.priorLevel === l.level ? 'seg-on' : ''} aria-pressed={draft.priorLevel === l.level} onClick={() => onPriorLevel(l.level)}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {orderActive && unknown === 0 && (
        <label className="check">
          <input type="checkbox" checked={draft.oppOrderKnown} onChange={(e) => onOrderKnown(e.target.checked)} />
          相手のカードも、上に入れた順番で出てくる(オーダー)
        </label>
      )}
    </div>
  );
}
