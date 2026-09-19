import type { MatchSetup, MatchView } from './match';
import type { CardDef, Player } from './types';

export const MAX_REMATCHES = 5;

/**
 * サドンデスの再戦を組む。各プレイヤーの手札は、終局時に支配していたカード
 * (盤面の自分の札 + 後攻なら手元に残った 1 枚)。タイプ枚数の累積は再戦ごとにリセットされる。
 *
 * 再戦時の先攻は公式の記載が無い。FFTriadBuddy と Steam のガイドは「前回の後攻が先攻(交互)」で
 * 一致しているのでそれを既定とし、starter で上書きできるようにしている。
 */
export function buildRematch(setup: MatchSetup, view: MatchView, starter?: Player): MatchSetup | null {
  if (!view.finished || view.outcome !== 'draw' || !setup.rules.suddenDeath) return null;
  if (setup.round >= MAX_REMATCHES) return null;

  const mine: CardDef[] = [];
  const theirs: (CardDef | null)[] = [];
  for (const c of view.state.board) {
    if (!c) continue;
    (c.owner === 0 ? mine : theirs).push(view.cards[c.card]);
  }
  // 後攻の手元の 1 枚
  if (setup.first === 1) {
    for (const i of view.myHand) mine.push(view.cards[i]);
  } else if (view.oppKnown.length > 0) {
    theirs.push(view.cards[view.oppKnown[0]]);
  } else if (view.oppUnknown > 0) {
    theirs.push(null);
  }
  if (mine.length !== 5 || theirs.length !== 5) return null;

  return {
    ...setup,
    myHand: mine,
    oppSlots: theirs,
    // 不明の 1 枚が残っている時だけ、まだ出ていない候補を引き継ぐ
    oppPool: theirs.includes(null) ? view.oppPool.map((i) => view.cards[i]) : [],
    first: starter ?? ((setup.first ^ 1) as Player),
    round: setup.round + 1,
    oppOrderKnown: false,
  };
}
