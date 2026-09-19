import type { CardDef } from './types';

/**
 * 手持ち(所持カード)とデッキの制限。
 * 手持ちはカード ID の集合で持つ(保存済みデッキの CardDef と違い、同じ数字の別カードを区別する必要があるため)。
 * core は同梱データを import しないので、ID とレアリティつきのカードは DeckCard として受け取る。
 */

export interface Collection {
  /** 所持しているカードの ID。昇順・重複なし */
  owned: number[];
}

export const EMPTY_COLLECTION: Collection = { owned: [] };

/** ID として受け付ける上限。壊れた入力で巨大な配列を作らないための歯止め */
export const MAX_CARD_ID = 9999;

function isCardId(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= MAX_CARD_ID;
}

function sortedUnique(ids: Iterable<number>): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * 同梱データに無い ID も捨てない(データを古い版に戻しても所持が消えないように)。
 * 表示する側が cardById で絞る。
 */
export function parseCollection(raw: string | null): Collection {
  if (!raw) return EMPTY_COLLECTION;
  try {
    const o = JSON.parse(raw) as { owned?: unknown };
    if (typeof o !== 'object' || o === null || !Array.isArray(o.owned)) return EMPTY_COLLECTION;
    return { owned: sortedUnique(o.owned.filter(isCardId)) };
  } catch {
    return EMPTY_COLLECTION;
  }
}

export function withOwned(c: Collection, ids: readonly number[], owned: boolean): Collection {
  const set = new Set(c.owned);
  for (const id of ids) {
    if (!isCardId(id)) continue;
    if (owned) set.add(id);
    else set.delete(id);
  }
  return { owned: sortedUnique(set) };
}

const EXPORT_PREFIX = 'triadnavi-cards:v1:';

/** 連続する ID は範囲にまとめる(例: triadnavi-cards:v1:1-53,60,72-80) */
export function exportCollection(c: Collection): string {
  const ids = sortedUnique(c.owned.filter(isCardId));
  const parts: string[] = [];
  for (let i = 0; i < ids.length; ) {
    let j = i;
    while (j + 1 < ids.length && ids[j + 1] === ids[j] + 1) j++;
    parts.push(j === i ? String(ids[i]) : `${ids[i]}-${ids[j]}`);
    i = j + 1;
  }
  return EXPORT_PREFIX + parts.join(',');
}

/**
 * 書き出した文字列、または手で書いた ID の並びを読む。空白・全角・読点・範囲(1-53、1〜53)を許す。
 * 読めない部分が 1 つでもあれば null(半端に取り込んで、気づかないまま所持が欠けるのを避ける)。
 */
export function importCollection(text: string): number[] | null {
  let s = text.normalize('NFKC').trim();
  const hasPrefix = s.toLowerCase().startsWith(EXPORT_PREFIX);
  if (hasPrefix) s = s.slice(EXPORT_PREFIX.length);
  const tokens = s.split(/[\s,、;]+/).filter((t) => t !== '');
  if (tokens.length === 0) return hasPrefix ? [] : null;
  const ids: number[] = [];
  for (const t of tokens) {
    const m = /^(\d{1,4})(?:[-~〜](\d{1,4}))?$/.exec(t);
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (!isCardId(lo) || !isCardId(hi) || hi < lo) return null;
    for (let id = lo; id <= hi; id++) ids.push(id);
  }
  return sortedUnique(ids);
}

/** デッキの検査と探索に使うカード。同梱データの CardInfo が構造的にこの形を満たす */
export interface DeckCard extends CardDef {
  readonly id: number;
  readonly stars: number;
}

export const DECK_SIZE = 5;
/** ★5 は 1 枚まで(公式プレイガイド) */
export const MAX_FIVE_STAR = 1;
/** ★4 以上は合わせて 2 枚まで。所持枚数による段階制限はパッチ 5.4 で無くなった */
export const MAX_FOUR_PLUS = 2;

export type DeckProblem = 'size' | 'duplicate' | 'fiveStar' | 'fourPlus';

export const DECK_PROBLEM_TEXT: Record<DeckProblem, string> = {
  size: 'デッキは 5 枚です',
  duplicate: '同じカードは 2 枚入れられません',
  fiveStar: '★5 のカードは 1 枚までです',
  fourPlus: '★4 以上のカードは合わせて 2 枚までです',
};

type Rated = Pick<DeckCard, 'id' | 'stars'>;

export function deckProblems(cards: readonly Rated[]): DeckProblem[] {
  const out: DeckProblem[] = [];
  if (cards.length !== DECK_SIZE) out.push('size');
  if (new Set(cards.map((c) => c.id)).size !== cards.length) out.push('duplicate');
  if (cards.filter((c) => c.stars >= 5).length > MAX_FIVE_STAR) out.push('fiveStar');
  if (cards.filter((c) => c.stars >= 4).length > MAX_FOUR_PLUS) out.push('fourPlus');
  return out;
}

export function isLegalDeck(cards: readonly Rated[]): boolean {
  return deckProblems(cards).length === 0;
}

/** deck の slot を card に替えても合法か */
export function canReplace(deck: readonly Rated[], slot: number, card: Rated): boolean {
  return isLegalDeck(deck.map((c, i) => (i === slot ? card : c)));
}
