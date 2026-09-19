import { NEIGHBOUR } from './geometry';
import { BIT_FALLEN_ACE, BIT_FALLEN_ACE_COMBO, BIT_PLUS, BIT_REVERSE, BIT_SAME } from './rules';
import type { CardDef, Player } from './types';

/**
 * 高速エンジン。探索専用で、型付き配列とビットマスクを書き換えて place()/undo() する。
 * 挙動の定義は refEngine.ts が正で、性質テスト(fastEngine.test.ts)で一致を保証する。
 *
 * 手札はカード添字のビットマスクで持つため、手札に入りうるカードの添字は 31 未満であること。
 */

/** 補正後の値の表。EFF[(shift + 9) * 11 + base] = clamp(base + shift, 1, 10) */
const EFF: Uint8Array = (() => {
  const t = new Uint8Array(19 * 11);
  for (let shift = -9; shift <= 9; shift++) {
    for (let base = 0; base <= 10; base++) {
      t[(shift + 9) * 11 + base] = Math.min(10, Math.max(1, base + shift));
    }
  }
  return t;
})();

const POP9: Uint8Array = (() => {
  const t = new Uint8Array(512);
  for (let i = 1; i < 512; i++) t[i] = t[i >> 1] + (i & 1);
  return t;
})();

export const FULL = 0x1ff;
export const MAX_HAND_CARDS = 31;

export interface FastSetup {
  cards: readonly CardDef[];
  /** 自分の手札(デッキの並び順)。オーダーでは先頭から強制される */
  myHand: readonly number[];
  /** 相手の既知の手札 */
  oppKnown: readonly number[];
  /** 相手の不明スロットに入りうる候補 */
  oppPool: readonly number[];
  /** 相手の不明スロットの残り数。プールのカードはこの枚数までしか出せない */
  poolQuota: number;
  board: readonly ({ card: number; owner: Player } | null)[];
  turn: Player;
  first: Player;
  ruleBits: number;
  /** タイプ補正の符号(+1 / -1 / 0) */
  sign: number;
  orderMe: boolean;
  orderOpp: boolean;
}

function capt(a: number, b: number, reverse: number, fallenAce: number): boolean {
  if (reverse) return a < b || (fallenAce !== 0 && a === 10 && b === 1);
  return a > b || (fallenAce !== 0 && a === 1 && b === 10);
}

export class FastBoard {
  readonly nCards: number;
  readonly sides: Uint8Array;
  readonly ctype: Uint8Array;
  /** dupMask[i] = 同じグループ内で i より前にある、i と同一のカードのビット */
  readonly dupMask: Int32Array;
  readonly cellCard = new Int8Array(9).fill(-1);
  readonly tcount = new Int8Array(5);
  readonly ruleBits: number;
  readonly sign: number;
  readonly orderMe: boolean;
  readonly orderOpp: boolean;
  readonly first: number;
  readonly poolMask: number;

  occ = 0;
  /** 相手(プレイヤー 1)が所有するマスのビット */
  own = 0;
  hand0 = 0;
  hand1 = 0;
  poolLeft = 0;
  turn = 0;
  placed = 0;

  private readonly s0 = new Int32Array(4);

  constructor(setup: FastSetup) {
    const n = setup.cards.length;
    this.nCards = n;
    this.sides = new Uint8Array(n * 4);
    this.ctype = new Uint8Array(n);
    this.dupMask = new Int32Array(n);
    setup.cards.forEach((c, i) => {
      for (let d = 0; d < 4; d++) this.sides[i * 4 + d] = c.sides[d];
      this.ctype[i] = c.type;
    });
    const groups = [setup.myHand, setup.oppKnown, setup.oppPool];
    let poolMask = 0;
    groups.forEach((g, gi) => {
      g.forEach((idx, k) => {
        if (idx >= MAX_HAND_CARDS) throw new Error('hand card index must be < 31');
        if (gi === 0) this.hand0 |= 1 << idx;
        else this.hand1 |= 1 << idx;
        if (gi === 2) poolMask |= 1 << idx;
        for (let j = 0; j < k; j++) if (this.sameCard(g[j], idx)) this.dupMask[idx] |= 1 << g[j];
      });
    });
    this.poolMask = poolMask;
    this.poolLeft = setup.poolQuota;
    this.ruleBits = setup.ruleBits;
    this.sign = setup.sign;
    this.orderMe = setup.orderMe;
    this.orderOpp = setup.orderOpp;
    this.first = setup.first;
    this.turn = setup.turn;
    setup.board.forEach((c, cell) => {
      if (!c) return;
      this.cellCard[cell] = c.card;
      this.occ |= 1 << cell;
      if (c.owner === 1) this.own |= 1 << cell;
      this.placed++;
      const t = this.ctype[c.card];
      if (t) this.tcount[t]++;
    });
  }

  private sameCard(a: number, b: number): boolean {
    if (this.ctype[a] !== this.ctype[b]) return false;
    for (let d = 0; d < 4; d++) if (this.sides[a * 4 + d] !== this.sides[b * 4 + d]) return false;
    return true;
  }

  /** 手番のプレイヤーが card を cell に置く。裏返ったマスのビットマスクを返す(undo に渡す) */
  place(card: number, cell: number): number {
    const me = this.turn;
    const bit = 1 << cell;
    const cellCard = this.cellCard;
    const sides = this.sides;
    const ctype = this.ctype;
    const tcount = this.tcount;
    const sign = this.sign;
    const bits = this.ruleBits;
    const reverse = bits & BIT_REVERSE;
    const S = this.s0;

    cellCard[cell] = card;
    const occ = this.occ | bit;
    let own = this.own;
    if (me) {
      own |= bit;
      this.hand1 &= ~(1 << card);
      if ((this.poolMask >>> card) & 1) this.poolLeft--;
    } else {
      this.hand0 &= ~(1 << card);
    }
    // 置いたマスは含まれない: me=1 なら own に入り、me=0 なら own に入らないため
    const oppOwned = me ? occ & ~own : own;

    // タイプ枚数はまだ増やさない。以下の比較は全カードが「増加前の枚数」で補正される
    const offP = (sign * tcount[ctype[card]] + 9) * 11;
    const fa = bits & BIT_FALLEN_ACE;
    let nmatch = 0;
    let sameMask = 0;
    let basic = 0;
    for (let d = 0; d < 4; d++) {
      const n = NEIGHBOUR[cell * 4 + d];
      if (n < 0 || !((occ >>> n) & 1)) {
        S[d] = -1;
        continue;
      }
      const oc = cellCard[n];
      const a = EFF[offP + sides[card * 4 + d]];
      const b = EFF[(sign * tcount[ctype[oc]] + 9) * 11 + sides[oc * 4 + ((d + 2) & 3)]];
      S[d] = a + b;
      if (a === b) {
        nmatch++;
        sameMask |= 1 << n;
      }
      if ((oppOwned >>> n) & 1 && capt(a, b, reverse, fa)) basic |= 1 << n;
    }

    // 自分のカードも条件には数えるが、裏返らずコンボの起点にもならない
    let special = 0;
    if (bits & BIT_SAME && nmatch >= 2) special = sameMask;
    if (bits & BIT_PLUS) {
      for (let i = 0; i < 3; i++) {
        if (S[i] < 0) continue;
        for (let j = i + 1; j < 4; j++) {
          if (S[i] === S[j]) special |= (1 << NEIGHBOUR[cell * 4 + i]) | (1 << NEIGHBOUR[cell * 4 + j]);
        }
      }
    }
    special &= oppOwned;

    let flips = special | basic;
    own ^= flips;

    // コンボ: セイム/プラスで取ったマスだけが起点。1 回の設置の中では裏返りは一方向で値も固定なので、
    // 処理順に依らず世代別 BFS(refEngine)と同じ結果になる
    if (special) {
      const faCombo = bits & BIT_FALLEN_ACE_COMBO;
      let queue = special;
      while (queue) {
        const low = queue & -queue;
        queue ^= low;
        const c = 31 - Math.clz32(low);
        const cc = cellCard[c];
        const offC = (sign * tcount[ctype[cc]] + 9) * 11;
        for (let d = 0; d < 4; d++) {
          const n = NEIGHBOUR[c * 4 + d];
          if (n < 0 || !((occ >>> n) & 1)) continue;
          if (((own >>> n) & 1) === me) continue;
          const oc = cellCard[n];
          const a = EFF[offC + sides[cc * 4 + d]];
          const b = EFF[(sign * tcount[ctype[oc]] + 9) * 11 + sides[oc * 4 + ((d + 2) & 3)]];
          if (capt(a, b, reverse, faCombo)) {
            const nb = 1 << n;
            own ^= nb;
            flips |= nb;
            queue |= nb;
          }
        }
      }
    }

    // 全ての解決の後にタイプ枚数を増やす。タイプなし(0)は数えず tcount[0] を常に 0 に保つ
    const t = ctype[card];
    if (t) tcount[t]++;
    this.occ = occ;
    this.own = own;
    this.turn = me ^ 1;
    this.placed++;
    return flips;
  }

  undo(card: number, cell: number, flips: number): void {
    const me = this.turn ^ 1;
    const bit = 1 << cell;
    this.turn = me;
    this.placed--;
    const t = this.ctype[card];
    if (t) this.tcount[t]--;
    this.own = (this.own ^ flips) & ~bit;
    this.occ &= ~bit;
    this.cellCard[cell] = -1;
    if (me) {
      this.hand1 |= 1 << card;
      if ((this.poolMask >>> card) & 1) this.poolLeft++;
    } else {
      this.hand0 |= 1 << card;
    }
  }

  /** 手番のプレイヤーが出せるカードのビット(プールの残り枠とオーダーを反映。重複排除はしない) */
  playable(): number {
    if (this.turn === 0) {
      const h = this.hand0;
      return this.orderMe ? h & -h : h;
    }
    let h = this.hand1;
    if (this.poolLeft <= 0) h &= ~this.poolMask;
    return this.orderOpp ? h & -h : h;
  }

  /** 自分(プレイヤー 0)の枚数。盤面が埋まっていること。後攻の手元の 1 枚を含む 10 枚で数える */
  myCount(): number {
    return POP9[this.occ & ~this.own & FULL] + (this.first === 1 ? 1 : 0);
  }

  /** 終局時の値(自分視点)。正 = 勝ち、0 = 引き分け、負 = 負け */
  myValue(): number {
    return this.myCount() - 5;
  }

  /** テスト用: 状態の要約 */
  snapshot(): string {
    return [
      Array.from(this.cellCard).join(','),
      this.occ, this.own, this.hand0, this.hand1, this.poolLeft, this.turn, this.placed,
      Array.from(this.tcount).join(','),
    ].join('|');
  }
}
