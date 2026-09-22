import { useState } from 'react';
import { CARD_TYPE_NAMES, formatSide, type CardDef, type Player } from '../core/types';
import { artIdOf, cardArtUrl } from '../data';
import { useCardArt } from '../hooks/useCardArt';

interface Props {
  /** null = 裏向き(不明)。empty を付けると「まだ入力していない空きスロット」の表示になる */
  card: CardDef | null;
  empty?: boolean;
  owner: Player | 'none';
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  recommended?: boolean;
  dimmed?: boolean;
  /** タイプアセンド/ディセンドによる補正値。ゲームと同じく、数字は元のまま表示し、中央に加減を出す */
  shift?: number;
  /** 入力中の表示: 確定済みの数字と、次に入る辺 */
  partial?: number[];
  showName?: boolean;
  badge?: string;
  onClick?: () => void;
  ariaLabel?: string;
}

/** 数字をゲームと同じひし形(上・左右・下)に並べたカード。設定が入っていて絵が決まるカードには、数字の下に絵を敷く */
export function CardView({ card, empty, owner, size = 'md', selected, recommended, dimmed, shift = 0, partial, showName = true, badge, onClick, ariaLabel }: Props) {
  const artOn = useCardArt();
  // 読み込みに失敗した絵。同じ CardView が後で別のカードを映す(スロットの入れ替え、再戦)ので、真偽値ではなく ID で覚える
  const [failedArt, setFailedArt] = useState<number | null>(null);
  const resolved = artOn && card && !partial ? artIdOf(card) : undefined;
  const artId = resolved === failedArt ? undefined : resolved;

  const cls = [
    'card', `card-${size}`, `owner-${owner}`,
    card === null && !partial ? (empty ? 'card-empty' : 'card-hidden') : '',
    artId !== undefined ? 'has-art' : '',
    selected ? 'is-selected' : '', recommended ? 'is-recommended' : '', dimmed ? 'is-dimmed' : '',
  ].filter(Boolean).join(' ');

  const side = (d: number) => {
    if (partial) return d < partial.length ? formatSide(partial[d]) : d === partial.length ? '_' : '';
    if (!card) return '';
    return formatSide(card.sides[d]);
  };
  const active = partial ? partial.length : -1;
  // タイプの無いカードには補正が掛からない。補正後の値のクランプ([1,10])はエンジン側の仕事で、表示には出さない
  const shown = !partial && card && card.type !== 0 ? shift : 0;

  const body = (
    <>
      {artId !== undefined && (
        // 先頭に置いて、数字や名前の下に敷く。key: src だけ差し替えると、次の絵が届くまで前のカードの絵が残る。
        // loading は src より先に書く(後だと、遅延の指定が効く前に読み込みを始めるブラウザがある)
        <img
          key={artId}
          className="card-art"
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          srcSet={size === 'sm' ? undefined : `${cardArtUrl(artId)} 1x, ${cardArtUrl(artId, true)} 2x`}
          src={cardArtUrl(artId)}
          onError={() => setFailedArt(artId)}
        />
      )}
      {card === null && !partial ? (
        <span className="card-unknown">{empty ? '+' : '?'}</span>
      ) : (
        <span className="card-sides">
          {[0, 3, 1, 2].map((d) => (
            <span key={d} className={`side side-${d}${active === d ? ' side-active' : ''}`}>
              {side(d)}
            </span>
          ))}
          {shown !== 0 && (
            <span className={`side side-shift ${shown > 0 ? 'shift-up' : 'shift-down'}`}>
              {shown > 0 ? `+${shown}` : `−${-shown}`}
            </span>
          )}
        </span>
      )}
      {card && card.type !== 0 && <span className="card-type">{CARD_TYPE_NAMES[card.type]}</span>}
      {badge && <span className="card-badge">{badge}</span>}
      {showName && !badge && size !== 'sm' && card?.label && <span className="card-name">{card.label}</span>}
    </>
  );

  return onClick ? (
    <button type="button" className={cls} onClick={onClick} aria-label={ariaLabel} aria-pressed={selected}>
      {body}
    </button>
  ) : (
    <span className={cls} aria-label={ariaLabel}>{body}</span>
  );
}
