import { cardNumber, cardSources, type CardInfo } from '../data';
import { Tip } from './Tip';

interface Props {
  id: string;
  card: CardInfo;
  /** 乗せたカードの画面上の位置 */
  anchor: DOMRect;
}

/** 手持ちの画面で、乗せたカードの入手方法を出す吹き出し */
export function SourceTip({ id, card, anchor }: Props) {
  const sources = cardSources(card.id);
  return (
    <Tip id={id} anchor={anchor} className="source-tip">
      <div className="source-tip-head">
        {cardNumber(card)} {card.name} <span className="coll-stars">★{card.stars}</span>
      </div>
      {sources.length === 0 ? (
        <p className="muted">入手方法の情報がありません</p>
      ) : (
        <dl>
          {sources.map((s, i) => (
            <div key={i} className="source-row">
              <dt>{s.kind}</dt>
              <dd>
                {s.text}
                {s.where && <span className="source-where">{s.where}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Tip>
  );
}
