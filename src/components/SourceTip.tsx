import { useLayoutEffect, useRef } from 'react';
import { cardNumber, cardSources, type CardInfo } from '../data';

/** 吹き出しとカードの間、画面の端との間の余白(px) */
const GAP = 6;
const MARGIN = 8;

interface Props {
  id: string;
  card: CardInfo;
  /** 乗せたカードの画面上の位置 */
  anchor: DOMRect;
}

/** 手持ちの画面で、乗せたカードの入手方法を出す吹き出し。カードの下に出し、入りきらなければ上。左右は画面の中に収める */
export function SourceTip({ id, card, anchor }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // 大きさは描いてみないと分からないので、描いた直後(画面に出る前)に位置を決める。
  // style を props で渡すと再描画のたびに React が上書きするので、要素に直接書く
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const below = anchor.bottom + GAP;
    const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, anchor.top - GAP - height);
    const left = Math.min(Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2), vw - MARGIN - width);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = 'visible';
  }, [anchor, card]);

  const sources = cardSources(card.id);
  return (
    <div ref={ref} id={id} role="tooltip" className="source-tip">
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
    </div>
  );
}
