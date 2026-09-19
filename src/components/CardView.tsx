import { CARD_TYPE_NAMES, formatSide, type CardDef, type Player } from '../core/types';

interface Props {
  /** null = 裏向き(不明)。empty を付けると「まだ入力していない空きスロット」の表示になる */
  card: CardDef | null;
  empty?: boolean;
  owner: Player | 'none';
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  recommended?: boolean;
  dimmed?: boolean;
  /** タイプアセンド/ディセンドによる補正値(表示は補正後の値) */
  shift?: number;
  /** 入力中の表示: 確定済みの数字と、次に入る辺 */
  partial?: number[];
  showName?: boolean;
  badge?: string;
  onClick?: () => void;
  ariaLabel?: string;
}

const clamp = (v: number) => Math.min(10, Math.max(1, v));

/** 数字をゲームと同じひし形(上・左右・下)に並べたカード */
export function CardView({ card, empty, owner, size = 'md', selected, recommended, dimmed, shift = 0, partial, showName = true, badge, onClick, ariaLabel }: Props) {
  const cls = [
    'card', `card-${size}`, `owner-${owner}`,
    card === null && !partial ? (empty ? 'card-empty' : 'card-hidden') : '',
    selected ? 'is-selected' : '', recommended ? 'is-recommended' : '', dimmed ? 'is-dimmed' : '',
  ].filter(Boolean).join(' ');

  const side = (d: number) => {
    if (partial) return d < partial.length ? formatSide(partial[d]) : d === partial.length ? '_' : '';
    if (!card) return '';
    return formatSide(card.type === 0 ? card.sides[d] : clamp(card.sides[d] + shift));
  };
  const active = partial ? partial.length : -1;

  const body = (
    <>
      {card === null && !partial ? (
        <span className="card-unknown">{empty ? '+' : '?'}</span>
      ) : (
        <span className="card-sides">
          {[0, 3, 1, 2].map((d) => (
            <span key={d} className={`side side-${d}${active === d ? ' side-active' : ''}${shift !== 0 && card?.type ? (shift > 0 ? ' side-up' : ' side-down') : ''}`}>
              {side(d)}
            </span>
          ))}
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
