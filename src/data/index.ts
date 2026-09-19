import type { Rng } from '../core/rng';
import type { CardDef, CardType, Sides } from '../core/types';
import cardsJson from './cards.json';
import npcsJson from './npcs.json';

/**
 * 同梱データ(`npm run data:update` で生成)。エンジンとソルバーは {sides, type} しか見ないので、
 * このモジュールを触るのは UI 層だけ。
 */

export interface CardInfo {
  id: number;
  name: string;
  sides: Sides;
  type: CardType;
  stars: number;
}

export interface NpcInfo {
  id: number;
  name: string;
  location: string;
  region: string;
  /** 必ず手札に入るカード */
  fixed: number[];
  /** 残りの枠に入りうるカード */
  variable: number[];
  /** 固定ルール(ゲームデータのルール ID)。ルーレット(1)が 2 つ入っている NPC もいる */
  rules: number[];
  usesRegional: boolean;
}

export const CARDS: readonly CardInfo[] = cardsJson as unknown as CardInfo[];
export const NPCS: readonly NpcInfo[] = npcsJson as unknown as NpcInfo[];

const byId = new Map(CARDS.map((c) => [c.id, c]));
const bySides = new Map<string, CardInfo[]>();
for (const c of CARDS) {
  const k = c.sides.join(',');
  const list = bySides.get(k);
  if (list) list.push(c);
  else bySides.set(k, [c]);
}

export function cardById(id: number): CardInfo | undefined {
  return byId.get(id);
}

/** 数字 4 つからの逆引き。ほとんどの組は 1 枚に決まる(同じ数字でタイプが違うのは 3 組だけ) */
export function findBySides(sides: Sides): CardInfo[] {
  return bySides.get(sides.join(',')) ?? [];
}

/** 逆引きの結果、タイプが 1 つに決まるならそのタイプ。候補が無い/食い違う場合は undefined */
export function typeFromSides(sides: Sides): CardType | undefined {
  const types = new Set(findBySides(sides).map((c) => c.type));
  return types.size === 1 ? [...types][0] : undefined;
}

export function toCardDef(c: CardInfo): CardDef {
  return { sides: c.sides, type: c.type, label: c.name };
}

/** ひらがな → カタカナ、英字は小文字、空白と中黒を除去 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[\s・･'’]/g, '');
}

const cardIndex = CARDS.map((c) => ({ c, key: normalize(c.name) }));
const npcIndex = NPCS.map((n) => ({ n, key: normalize(n.name), place: normalize(n.location + n.region) }));

export function searchCards(query: string, limit = 30): CardInfo[] {
  const q = normalize(query);
  if (!q) return [];
  const starts = cardIndex.filter((x) => x.key.startsWith(q));
  const contains = cardIndex.filter((x) => !x.key.startsWith(q) && x.key.includes(q));
  return [...starts, ...contains].slice(0, limit).map((x) => x.c);
}

/** 名前または場所で NPC を探す */
export function searchNpcs(query: string, limit = 40): NpcInfo[] {
  const q = normalize(query);
  if (!q) return NPCS.slice(0, limit);
  const byName = npcIndex.filter((x) => x.key.includes(q));
  const byPlace = npcIndex.filter((x) => !x.key.includes(q) && x.place.includes(q));
  return [...byName, ...byPlace].slice(0, limit).map((x) => x.n);
}

export function npcById(id: number): NpcInfo | undefined {
  return NPCS.find((n) => n.id === id);
}

export function npcCards(npc: NpcInfo): { fixed: CardInfo[]; variable: CardInfo[] } {
  const get = (ids: number[]) => ids.map((id) => byId.get(id)).filter((c): c is CardInfo => c !== undefined);
  return { fixed: get(npc.fixed), variable: get(npc.variable) };
}

/** 相手の候補が不明な時に、不明スロットを埋める実カードを引く。強さの想定は 3 段階 */
export type PriorLevel = 1 | 2 | 3;

const PRIOR_WEIGHTS: Record<PriorLevel, number[]> = {
  // ★1〜★5 の重み
  1: [4, 5, 3, 0.5, 0],
  2: [0.5, 2, 6, 1.5, 0.7],
  3: [0, 0.5, 5, 2.5, 2],
};

const byStars = [1, 2, 3, 4, 5].map((s) => CARDS.filter((c) => c.stars === s));

export function samplePriorCard(rng: Rng, level: PriorLevel): CardDef {
  const weights = PRIOR_WEIGHTS[level];
  let x = rng() * weights.reduce((a, b) => a + b, 0);
  let star = 0;
  for (; star < 4; star++) {
    x -= weights[star];
    if (x < 0) break;
  }
  const list = byStars[star];
  return toCardDef(list[Math.floor(rng() * list.length)]);
}
