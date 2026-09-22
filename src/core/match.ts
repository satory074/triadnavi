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
  /** 対局中に分かったカード(index = view.revealed の何番目か) */
  | { from: 'revealed'; index: number }
  /** 相手が候補リストに無いカードを出した */
  | { from: 'adhoc'; card: CardDef };

/** スワップで相手から来たカードの指定(自分の手札からは来ない) */
export type SwapRef = Exclude<CardRef, { from: 'my' }>;

/** 相手の不明スロットを 1 枚開く時の指定。候補リストから選ぶか、数字を手入力する */
export type RevealRef =
  | { from: 'pool'; index: number }
  | { from: 'adhoc'; card: CardDef };

export type MatchEvent =
  | { t: 'place'; by: Player; card: CardRef; cell: number }
  /** オールオープン等で見えている相手の手札を、出される前に開く */
  | { t: 'reveal'; card: RevealRef }
  /** スワップ: 自分の手札 mine(setup.myHand の添字)と、相手の 1 枚を入れ替える */
  | { t: 'swap'; mine: number; theirs: SwapRef }
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
  /**
   * 対局中に手札の中身が分かった/入れ替わったカード(cards への添字。イベントの順)。
   * 設定の時点では持ち主が決まっていないので、CardRef の 'revealed' で参照する
   */
  revealed: number[];
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
  const revealed: number[] = [];
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

    if (ev.t === 'reveal') {
      // 開いたカードは oppKnown の末尾に付く(相手の出す順は分からないままにする)
      if (oppUnknown <= 0) break;
      let idx = -1;
      const ref = ev.card;
      if (ref.from === 'pool') {
        idx = poolIdx[ref.index] ?? -1;
        if (!oppPool.includes(idx)) break;
        oppPool = oppPool.filter((i) => i !== idx);
      } else if (ref.from === 'adhoc') {
        idx = cards.push(ref.card) - 1;
        state = { ...state, cards };
        // 候補リストを入れていたのに、そこに無いカードが見えた = それまでの保証は成り立っていなかった
        if (setup.oppPool.length > 0) outOfPool = true;
      } else {
        break;
      }
      oppKnown = [...oppKnown, idx];
      revealed.push(idx);
      oppUnknown--;
      applied++;
      continue;
    }

    if (ev.t === 'swap') {
      const mi = myIdx[ev.mine] ?? -1;
      if (!myHand.includes(mi)) break;
      let ti = -1;
      const ref = ev.theirs;
      if (ref.from === 'opp') {
        ti = oppIdx[ref.index] ?? -1;
        if (!oppKnown.includes(ti)) break;
      } else if (ref.from === 'revealed') {
        ti = revealed[ref.index] ?? -1;
        if (!oppKnown.includes(ti)) break;
      } else if (ref.from === 'pool') {
        ti = poolIdx[ref.index] ?? -1;
        if (!oppPool.includes(ti) || oppUnknown <= 0) break;
        oppPool = oppPool.filter((i) => i !== ti);
        oppUnknown--;
      } else if (ref.from === 'adhoc') {
        if (oppUnknown <= 0) break;
        ti = cards.push(ref.card) - 1;
        state = { ...state, cards };
        if (setup.oppPool.length > 0) outOfPool = true;
        oppUnknown--;
      } else {
        break;
      }
      // 来たカードは、渡したカードと同じ位置に入るものとする(オーダーの並びに効く。実機未確認)
      myHand = myHand.map((i) => (i === mi ? ti : i));
      oppKnown = oppKnown.includes(ti) ? oppKnown.map((i) => (i === ti ? mi : i)) : [...oppKnown, mi];
      for (const i of [ti, mi]) if (!revealed.includes(i)) revealed.push(i);
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
    } else if (ref.from === 'revealed') {
      idx = revealed[ref.index] ?? -1;
      // スワップで持ち主が変わるので、どちらの手札にあるかで判断する
      if (ev.by === 0 && myHand.includes(idx)) myHand = myHand.filter((i) => i !== idx);
      else if (ev.by === 1 && oppKnown.includes(idx)) oppKnown = oppKnown.filter((i) => i !== idx);
      else break;
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
    cards, state, myHand, oppKnown, oppPool, oppUnknown, revealed, turn, placed,
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
    // 対局中に手札が変わったら(開く/スワップ)、入力順 = 出す順という前提は使えない
    oppOrderKnown: setup.oppOrderKnown && setup.round === 0 && view.revealed.length === 0,
  };
}

/** オーダー(最初の対局)で自分が出せるカード。それ以外は null(制約なし、またはユーザーの指定待ち) */
export function orderForcedCard(setup: MatchSetup, view: MatchView): number | null {
  if (setup.rules.pick !== 'order' || setup.round > 0) return null;
  return view.myHand.length > 0 ? view.myHand[0] : null;
}

/** cards への添字から、イベントに記録する CardRef を作る */
export function cardRefOf(setup: MatchSetup, cardIndex: number, revealed: readonly number[] = []): CardRef | null {
  // 対局中に分かったカードは候補リストの添字と重なるので、先に見る
  const r = revealed.indexOf(cardIndex);
  if (r >= 0) return { from: 'revealed', index: r };
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

/**
 * 対局中に開いた相手のカードを「?」に戻す(開き間違いの修正)。戻した記録を足すのではなく、開いた記録(reveal)を消して
 * 開かなかったことにする。後の記録が指す 'revealed' の添字は、消した位置より後を 1 つ詰める
 * (reveal は必ず 1 件で 1 枚を revealed の末尾に足すので、ずれるのは 1 つだけ)。
 * 戻せるのは reveal で開いてまだ出していないカードだけ。出した・交換したカード(後の記録が同じ添字を指す)、
 * スワップで来たカードは null。
 */
export function unrevealCard(setup: MatchSetup, events: readonly MatchEvent[], cardIndex: number): MatchEvent[] | null {
  const view = replay(setup, events);
  const valid = events.slice(0, view.applied);
  const r = view.revealed.indexOf(cardIndex);
  if (r < 0 || !view.oppKnown.includes(cardIndex)) return null;

  // r 番目を revealed に足した記録を探す
  let k = -1;
  for (let i = 0; i < valid.length && k < 0; i++) {
    if (replay(setup, valid.slice(0, i + 1)).revealed.length > r) k = i;
  }
  if (k < 0 || valid[k].t !== 'reveal') return null;

  const shift = <T extends CardRef>(ref: T): T | null => {
    if (ref.from !== 'revealed') return ref;
    if (ref.index === r) return null;
    return ref.index > r ? { ...ref, index: ref.index - 1 } : ref;
  };
  const next: MatchEvent[] = [];
  for (let i = 0; i < valid.length; i++) {
    if (i === k) continue;
    const ev = valid[i];
    if (ev.t === 'place') {
      const card = shift(ev.card);
      if (!card) return null;
      next.push({ ...ev, card });
    } else if (ev.t === 'swap') {
      const theirs = shift(ev.theirs);
      if (!theirs) return null;
      next.push({ ...ev, theirs });
    } else {
      next.push(ev);
    }
  }
  // 詰めた添字で全ての記録が再生できること(途中で切れるなら、どこかが別のカードを指している)
  return replay(setup, next).applied === next.length ? next : null;
}
