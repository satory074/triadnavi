import type { CardDef, CardType, Sides } from './types';

/** ブラウザに保存するデータの形と、壊れた/古い保存データに対する読み込み */

export interface SavedDeck {
  id: string;
  name: string;
  cards: CardDef[];
}

export interface SavedData {
  decks: SavedDeck[];
  /** NPC ごとに、同梱データの候補リストに無かったが実際に出てきたカード */
  learned: Record<string, CardDef[]>;
}

export const EMPTY_SAVED: SavedData = { decks: [], learned: {} };

export function parseCard(x: unknown): CardDef | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as { sides?: unknown; type?: unknown; label?: unknown };
  if (!Array.isArray(o.sides) || o.sides.length !== 4) return null;
  if (!o.sides.every((v) => Number.isInteger(v) && v >= 1 && v <= 10)) return null;
  const type = Number.isInteger(o.type) && (o.type as number) >= 0 && (o.type as number) <= 4 ? (o.type as CardType) : 0;
  const card: CardDef = { sides: o.sides as unknown as Sides, type };
  return typeof o.label === 'string' ? { ...card, label: o.label } : card;
}

export function parseSaved(raw: string | null): SavedData {
  if (!raw) return EMPTY_SAVED;
  try {
    const o = JSON.parse(raw) as { decks?: unknown; learned?: unknown };
    const decks: SavedDeck[] = [];
    if (Array.isArray(o.decks)) {
      for (const d of o.decks as { id?: unknown; name?: unknown; cards?: unknown }[]) {
        if (typeof d?.id !== 'string' || typeof d.name !== 'string' || !Array.isArray(d.cards)) continue;
        const cards = d.cards.map(parseCard);
        if (cards.length === 5 && cards.every((c) => c !== null)) decks.push({ id: d.id, name: d.name, cards: cards as CardDef[] });
      }
    }
    const learned: Record<string, CardDef[]> = {};
    if (typeof o.learned === 'object' && o.learned !== null) {
      for (const [k, v] of Object.entries(o.learned)) {
        if (!Array.isArray(v)) continue;
        const cards = v.map(parseCard).filter((c): c is CardDef => c !== null);
        if (cards.length > 0) learned[k] = cards;
      }
    }
    return { decks, learned };
  } catch {
    return EMPTY_SAVED;
  }
}

/** デッキ名の上限。保存時の入力欄(maxLength)と同じ */
export const DECK_NAME_MAX = 20;

/** 保存済みデッキの名前を変える。前後の空白は落とし、空なら変えない(名前の無いデッキを作らない) */
export function renameDeck(data: SavedData, id: string, name: string): SavedData {
  const next = name.trim().slice(0, DECK_NAME_MAX);
  if (next === '') return data;
  return { ...data, decks: data.decks.map((d) => (d.id === id ? { ...d, name: next } : d)) };
}

export function sameCard(a: CardDef, b: CardDef): boolean {
  return a.type === b.type && a.sides.every((v, i) => v === b.sides[i]);
}

/** 候補リストに無かったカードを、その NPC の学習済みカードに加える */
export function learnCards(data: SavedData, npcKey: string, seen: readonly CardDef[], known: readonly CardDef[]): SavedData {
  const current = data.learned[npcKey] ?? [];
  const added = seen.filter((c) => ![...known, ...current].some((k) => sameCard(k, c)));
  if (added.length === 0) return data;
  const unique = added.filter((c, i) => added.findIndex((d) => sameCard(c, d)) === i);
  return { ...data, learned: { ...data.learned, [npcKey]: [...current, ...unique] } };
}
