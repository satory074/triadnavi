import type { Position } from './position';
import { emptyState, isFull, placeRef, scoreRef, type Flip, type RefState } from './refEngine';
import type { CardDef, EngineOptions, Outcome, Player, RuleSet } from './types';

/**
 * 対局の記録はイベントソーシング。setup と events から replay() で現在の状態を再構築する。
 * 取り消しは events の末尾を捨てるだけでよく、再読み込み後の復元も同じ経路を通る。
 */

export interface MatchSetup {
  rules: RuleSet;
  options: EngineOptions;
  /** 自分の手札 5 枚(デッキの並び順) */
  myHand: CardDef[];
  /** 相手の手札 5 スロット。数字が分かっているカード、または null(裏向きで不明) */
  oppSlots: (CardDef | null)[];
  /** 相手の不明スロットに入りうる候補(NPC の可変プールなど) */
  oppPool: CardDef[];
  first: Player;
  /** 0 = 最初の対局、1 以上 = サドンデスの再戦回数 */
  round: number;
  /** オーダーで、相手の並び順が oppSlots の順だと分かっているか */
  oppOrderKnown: boolean;
  npcId?: number;
}

export type CardRef =
  | { from: 'my'; index: number }
  | { from: 'opp'; index: number }
  | { from: 'pool'; index: number }
  /** 相手が候補リストに無いカードを出した */
  | { from: 'adhoc'; card: CardDef };

export type MatchEvent =
  | { t: 'place'; by: Player; card: CardRef; cell: number }
  /** エンジンの計算が実機と食い違った時の手動修正 */
  | { t: 'setOwner'; cell: number; owner: Player };

export interface MatchView {
  cards: CardDef[];
  state: RefState;
  /** 未使用のカード(cards への添字) */
  myHand: number[];
  oppKnown: number[];
  oppPool: number[];
  oppUnknown: number;
  turn: Player;
  placed: number;
  lastFlips: Flip[];
  lastCell: number | null;
  /** 所有を手動で修正したことがある(以降の保証は参考) */
  overridden: boolean;
  /** 入力した手札や候補リストに無いカードが出た(それまでの保証は無効だった) */
  outOfPool: boolean;
  finished: boolean;
  score: { me: number; opp: number } | null;
  outcome: Outcome | null;
  /** 再生できたイベントの数(壊れたイベント以降は捨てる) */
  applied: number;
}

export function cardRefEquals(a: CardRef, b: CardRef): boolean {
  if (a.from !== b.from) return false;
  if (a.from === 'adhoc' || b.from === 'adhoc') return false;
  return a.index === b.index;
}

export function replay(setup: MatchSetup, events: readonly MatchEvent[]): MatchView {
  const cards: CardDef[] = [];
  const myIdx = setup.myHand.map((c) => cards.push(c) - 1);
  const oppIdx = setup.oppSlots.map((c) => (c ? cards.push(c) - 1 : -1));
  const poolIdx = setup.oppPool.map((c) => cards.push(c) - 1);

  let myHand = myIdx.slice();
  let oppKnown = oppIdx.filter((i) => i >= 0);
  let oppPool = poolIdx.slice();
  let oppUnknown = setup.oppSlots.filter((c) => c === null).length;
  let state = emptyState(cards, setup.rules, setup.options);
  let turn: Player = setup.first;
  let placed = 0;
  let lastFlips: Flip[] = [];
  let lastCell: number | null = null;
  let overridden = false;
  let outOfPool = false;
  let applied = 0;

  for (const ev of events) {
    if (ev.t === 'setOwner') {
      const c = state.board[ev.cell];
      if (!c) break;
      if (c.owner !== ev.owner) {
        const board = state.board.slice();
        board[ev.cell] = { card: c.card, owner: ev.owner };
        state = { ...state, board };
        overridden = true;
      }
      applied++;
      continue;
    }

    if (placed >= 9 || ev.by !== turn || ev.cell < 0 || ev.cell > 8 || state.board[ev.cell]) break;
    let idx = -1;
    const ref = ev.card;
    if (ref.from === 'my' && ev.by === 0) {
      idx = myIdx[ref.index] ?? -1;
      if (!myHand.includes(idx)) break;
      myHand = myHand.filter((i) => i !== idx);
    } else if (ref.from === 'opp' && ev.by === 1) {
      idx = oppIdx[ref.index] ?? -1;
      if (!oppKnown.includes(idx)) break;
      oppKnown = oppKnown.filter((i) => i !== idx);
    } else if (ref.from === 'pool' && ev.by === 1) {
      idx = poolIdx[ref.index] ?? -1;
      if (!oppPool.includes(idx) || oppUnknown <= 0) break;
      oppPool = oppPool.filter((i) => i !== idx);
      oppUnknown--;
    } else if (ref.from === 'adhoc' && ev.by === 1) {
      idx = cards.push(ref.card) - 1;
      state = { ...state, cards };
      if (oppUnknown > 0) {
        oppUnknown--;
        if (setup.oppPool.length > 0) outOfPool = true;
      } else {
        // 手札を全て既知として入力していたのに、別のカードが出た(入力ミス)。詰まないよう受け付ける。
        // 既知の手札が 1 枚余るが、相手の選択肢が増えるだけなので保証は悲観側に倒れる
        outOfPool = true;
      }
    } else {
      break;
    }

    const res = placeRef(state, ev.by, idx, ev.cell);
    state = res.state;
    lastFlips = res.flips;
    lastCell = ev.cell;
    turn = (turn ^ 1) as Player;
    placed++;
    applied++;
  }

  const finished = isFull(state);
  const score = finished ? scoreRef(state, setup.first) : null;
  const outcome: Outcome | null = score ? (score.me > score.opp ? 'win' : score.me === score.opp ? 'draw' : 'loss') : null;

  return {
    cards, state, myHand, oppKnown, oppPool, oppUnknown, turn, placed,
    lastFlips, lastCell, overridden, outOfPool, finished, score, outcome, applied,
  };
}

/** カードを出す順がゲームに強制され、どのカードかをユーザーに教えてもらう必要があるか */
export function needsForcedCard(setup: MatchSetup): boolean {
  // サドンデスの再戦では手札の並びが分からないので、オーダーでもカオスと同じ扱いにする
  return setup.rules.pick === 'chaos' || (setup.rules.pick === 'order' && setup.round > 0);
}

/** ソルバーへの入力を作る。forcedCard は cards への添字(カオス等でユーザーがタップしたカード) */
export function toPosition(setup: MatchSetup, view: MatchView, forcedCard?: number): Position {
  const forcedMode = needsForcedCard(setup);
  return {
    cards: view.cards,
    board: view.state.board.map((c) => (c ? { card: c.card, owner: c.owner } : null)),
    myHand: view.myHand,
    oppKnown: view.oppKnown,
    oppPool: view.oppPool,
    oppUnknown: view.oppUnknown,
    turn: view.turn,
    first: setup.first,
    rules: forcedMode ? { ...setup.rules, pick: 'chaos' } : setup.rules,
    options: setup.options,
    forcedCard: forcedMode ? forcedCard : undefined,
    oppOrderKnown: setup.oppOrderKnown && setup.round === 0,
  };
}

/** オーダー(最初の対局)で自分が出せるカード。それ以外は null(制約なし、またはユーザーの指定待ち) */
export function orderForcedCard(setup: MatchSetup, view: MatchView): number | null {
  if (setup.rules.pick !== 'order' || setup.round > 0) return null;
  return view.myHand.length > 0 ? view.myHand[0] : null;
}

/** cards への添字から、イベントに記録する CardRef を作る */
export function cardRefOf(setup: MatchSetup, cardIndex: number): CardRef | null {
  const nMy = setup.myHand.length;
  if (cardIndex < nMy) return { from: 'my', index: cardIndex };
  let k = nMy;
  for (let i = 0; i < setup.oppSlots.length; i++) {
    if (setup.oppSlots[i] === null) continue;
    if (k === cardIndex) return { from: 'opp', index: i };
    k++;
  }
  const p = cardIndex - k;
  return p >= 0 && p < setup.oppPool.length ? { from: 'pool', index: p } : null;
}
