import type { CardDef, Player } from '../core/types';
import { cardName } from '../data/historyExport';
import { CardView } from './CardView';

/** ★の表示に使う。DeckAdvisor の評価結果は DeckCard(stars 付き)で来る */
type StripCard = CardDef & { stars?: number };

interface Props {
  cards: readonly (StripCard | null)[];
  owner?: Player;
  /** null を「まだ入力していない空きスロット」として出す(ドラフトの提示セット) */
  empty?: boolean;
  /** 幅の指定(.hist-cards など)。ルートの .deck-strip に足す */
  className?: string;
  onSlot?: (i: number) => void;
  slotLabel?: (i: number, card: StripCard | null) => string;
}

/**
 * デッキ 1 つを、絵つきの札 + 名前で横一列に見せる。
 * 札は小さいので名前は重ねずに下へ出す(CardView の showName は使わない)。
 * 名前は cardName で引くので、数字だけで入力して label が付かなかったカードにも名前が出る
 */
export function DeckStrip({ cards, owner = 0, empty, className, onSlot, slotLabel }: Props) {
  return (
    <span className={`deck-strip${className ? ` ${className}` : ''}`}>
      {cards.map((card, i) => (
        <span className="slot" key={i}>
          <CardView
            card={card}
            empty={empty}
            owner={owner}
            size="sm"
            showName={false}
            onClick={onSlot ? () => onSlot(i) : undefined}
            ariaLabel={slotLabel?.(i, card)}
          />
          <span className="pool-name">
            {card ? cardName(card) : ''}
            {card && card.stars !== undefined && card.stars > 0 && <span className="coll-stars"> ★{card.stars}</span>}
          </span>
        </span>
      ))}
    </span>
  );
}
