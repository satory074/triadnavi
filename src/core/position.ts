import { FastBoard, MAX_HAND_CARDS, type FastSetup } from './fastEngine';
import { toRuleBits, typeSign } from './rules';
import type { CardDef, EngineOptions, Player, RuleSet } from './types';

/**
 * ソルバーが見る唯一の入力。カードは cards への添字で参照する。
 * 手番は常に「これから手を選ぶ側」。おすすめの計算は自分の手番(turn = 0)でのみ行う。
 */
export interface Position {
  cards: CardDef[];
  board: ({ card: number; owner: Player } | null)[];
  /** 自分の未使用の手札(デッキの並び順) */
  myHand: number[];
  /** 相手の未使用の手札のうち、数字が分かっているもの */
  oppKnown: number[];
  /** 相手の不明スロットに入りうる候補カード */
  oppPool: number[];
  /** 相手の不明スロットの残り数 */
  oppUnknown: number;
  turn: Player;
  first: Player;
  rules: RuleSet;
  options: EngineOptions;
  /** 今の手番で出すカードがゲームに強制されている場合(カオス等)。cards への添字 */
  forcedCard?: number;
  /** オーダーで、相手の並び順が oppKnown の順だと分かっているか */
  oppOrderKnown: boolean;
}

export type GuaranteeKind = 'exact' | 'pool' | 'estimate' | 'chaos';

export function placedCount(pos: Position): number {
  return pos.board.reduce((n, c) => n + (c ? 1 : 0), 0);
}

/** 相手がこの先置く枚数 */
export function oppPlaysLeft(pos: Position): number {
  const remaining = 9 - placedCount(pos);
  return pos.turn === 1 ? Math.ceil(remaining / 2) : Math.floor(remaining / 2);
}

/** 候補リストだけで相手の残りの手を賄えるか(賄えなければ上位集合の探索はできない) */
export function poolIsSufficient(pos: Position): boolean {
  if (pos.oppUnknown === 0) return true;
  const usable = Math.min(pos.oppUnknown, pos.oppPool.length);
  return pos.oppPool.length >= pos.oppUnknown && pos.oppKnown.length + usable >= oppPlaysLeft(pos);
}

export function guaranteeKind(pos: Position): GuaranteeKind {
  if (pos.rules.pick === 'chaos') return 'chaos';
  if (pos.oppUnknown === 0) return 'exact';
  return poolIsSufficient(pos) ? 'pool' : 'estimate';
}

export interface FastMapping {
  board: FastBoard;
  /** 高速エンジンの添字 → Position.cards の添字 */
  toPos: number[];
  /** Position.cards の添字 → 高速エンジンの添字(使われないカードは -1) */
  toFast: number[];
}

/**
 * 高速エンジンへ変換する。手札に入りうるカードを若い添字に詰め直す
 * (手札はビットマスクで持つため 31 未満である必要がある)。
 */
export function toFastBoard(pos: Position): FastMapping {
  const toPos: number[] = [];
  const toFast: number[] = Array(pos.cards.length).fill(-1);
  const add = (i: number) => {
    if (toFast[i] < 0) {
      toFast[i] = toPos.length;
      toPos.push(i);
    }
    return toFast[i];
  };
  const myHand = pos.myHand.map(add);
  const oppKnown = pos.oppKnown.map(add);
  const usePool = pos.oppUnknown > 0;
  const oppPool = usePool ? pos.oppPool.map(add) : [];
  if (toPos.length > MAX_HAND_CARDS) throw new Error('候補カードが多すぎます');
  const board = pos.board.map((c) => (c ? { card: add(c.card), owner: c.owner } : null));

  const order = pos.rules.pick === 'order';
  const setup: FastSetup = {
    cards: toPos.map((i) => pos.cards[i]),
    myHand,
    oppKnown,
    oppPool,
    poolQuota: usePool ? pos.oppUnknown : 0,
    board,
    turn: pos.turn,
    first: pos.first,
    ruleBits: toRuleBits(pos.rules, pos.options),
    sign: typeSign(pos.rules),
    orderMe: order && pos.forcedCard === undefined,
    // 相手の順番を強制するのは、並び順が既知で手札が全て分かっている時だけ(それ以外は自由 = 健全な緩和)
    orderOpp: order && pos.oppOrderKnown && pos.oppUnknown === 0,
  };
  return { board: new FastBoard(setup), toPos, toFast };
}

/** 局面の同一性判定用のキー。ワーカーからの古い応答を捨てるのに使う */
export function positionKey(pos: Position): string {
  const card = (i: number) => `${pos.cards[i].sides.join('.')}t${pos.cards[i].type}`;
  return [
    pos.board.map((c) => (c ? `${card(c.card)}o${c.owner}` : '-')).join(','),
    pos.myHand.map(card).join(','),
    pos.oppKnown.map(card).join(','),
    pos.oppPool.map(card).join(','),
    pos.oppUnknown,
    pos.turn,
    pos.first,
    JSON.stringify(pos.rules),
    JSON.stringify(pos.options),
    pos.forcedCard === undefined ? '' : card(pos.forcedCard),
    pos.oppOrderKnown ? 1 : 0,
  ].join('|');
}
