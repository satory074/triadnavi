import { deckProblems, type Collection, type DeckCard, type DeckProblem } from '../core/collection';
import type { Rng } from '../core/rng';
import type { CardDef, CardType, Sides } from '../core/types';
import cardsJson from './cards.json';
import npcsJson from './npcs.json';
import sourcesJson from './sources.json';

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
  /** ゲーム内カードリストの番号(No. 1〜、ex なら Ex. 1〜)。ID 順とは一致しない */
  order: number;
  ex: boolean;
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

/** カードの入手方法 1 件。FFXIV Collect の記載を日本語にそろえたもの(英語の文章の訳は scripts/source-ja.json) */
export interface CardSource {
  /** 分類(「NPC 対戦」「ダンジョン」「MGP 交換」「パック」など) */
  kind: string;
  /** 何から手に入るか(NPC の名前、コンテンツ名、交換の相手と値段など) */
  text: string;
  /** 場所や値段の補足(NPC なら場所と座標) */
  where?: string;
}

export const CARDS: readonly CardInfo[] = cardsJson as unknown as CardInfo[];
export const NPCS: readonly NpcInfo[] = npcsJson as unknown as NpcInfo[];
export const CARD_SOURCES: ReadonlyMap<number, readonly CardSource[]> = new Map(
  (sourcesJson as { id: number; sources: CardSource[] }[]).map((x) => [x.id, x.sources]),
);

/** カードの入手方法。同梱データに無いカードは空 */
export function cardSources(id: number): readonly CardSource[] {
  return CARD_SOURCES.get(id) ?? [];
}

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

/**
 * 所持しているカード。同梱データに無い ID は落とす(古い版に戻しても保存は消さない方針なので、絞るのは表示側)。
 * ヘッダーの枚数と手持ちの画面の枚数を食い違わせないため、数え方はここ 1 箇所に置く。
 */
export function ownedCards(c: Collection): CardInfo[] {
  return c.owned.map((id) => byId.get(id)).filter((x): x is CardInfo => x !== undefined);
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

export function toDeckCard(c: CardInfo): DeckCard {
  return { id: c.id, stars: c.stars, sides: c.sides, type: c.type, label: c.name };
}

/** ゲーム内カードリストと同じ並び(No. 順、その後に Ex.) */
export const CARDS_IN_LIST_ORDER: readonly CardInfo[] = [...CARDS].sort((a, b) => Number(a.ex) - Number(b.ex) || a.order - b.order);

export function cardNumber(c: CardInfo): string {
  return `${c.ex ? 'Ex.' : 'No.'} ${c.order}`;
}

/**
 * 数字とタイプからカード ID の候補を引く。数字もタイプも同じカードが 6 組あるので、名前が一致するものを先頭にする。
 * 手入力のカード(同梱データに無い数字)は空になる。
 */
export function resolveCardIds(card: CardDef): number[] {
  const hits = findBySides(card.sides).filter((c) => c.type === card.type);
  return [...hits.filter((c) => c.name === card.label), ...hits.filter((c) => c.name !== card.label)].map((c) => c.id);
}

/** 手札 5 枚を同梱データのカードに対応づける。対応がつかないカードがあれば null。同じ ID は 2 回使わない */
export function resolveDeck(cards: readonly CardDef[]): CardInfo[] | null {
  const used = new Set<number>();
  const out: CardInfo[] = [];
  for (const card of cards) {
    const id = resolveCardIds(card).find((x) => !used.has(x));
    if (id === undefined) return null;
    used.add(id);
    out.push(byId.get(id)!);
  }
  return out;
}

/**
 * カードの絵に使う ID。数字で 1 枚に決まるか、名前が一致する時だけ返す(違う絵を出すくらいなら出さない)。
 * 数字が同じカードは 9 組ある(タイプも同じ 6 組と、タイプだけが違う 3 組)。タイプでは絞らない:
 * タイプが結果に効かない時、CardEditor は先頭の候補のタイプで確定するので、タイプが違うだけの 3 組を取り違える。
 */
export function artIdOf(card: CardDef): number | undefined {
  const hits = findBySides(card.sides);
  if (hits.length === 1) return hits[0].id;
  return hits.find((c) => c.name === card.label)?.id;
}

/**
 * カードの絵(金の枠と絵柄。内側と四隅は透明)の URL。アイコン番号は 87000 + ID で、hr は 2 倍の解像度。
 * 同梱せず、XIVAPI を実行時に参照する。JPEG は透過が黒く潰れるので使わない。
 */
export function cardArtUrl(id: number, hr = false): string {
  const icon = 87000 + id;
  const folder = String(Math.floor(icon / 1000) * 1000).padStart(6, '0');
  return `https://v2.xivapi.com/api/asset?path=ui/icon/${folder}/${String(icon).padStart(6, '0')}${hr ? '_hr1' : ''}.tex&format=webp`;
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

/**
 * 入力中の手札がデッキの制限に反していないか。同梱データに無い(手入力の)カードはレアリティが分からないので数えない。
 * 枚数は見ない(入力の途中でも使うため)。
 */
export function handProblems(cards: readonly (CardDef | null)[]): DeckProblem[] {
  const used = new Set<number>();
  const rated: { id: number; stars: number }[] = [];
  let duplicate = false;
  for (const card of cards) {
    if (!card) continue;
    const ids = resolveCardIds(card);
    if (ids.length === 0) continue;
    const id = ids.find((x) => !used.has(x));
    if (id === undefined) {
      duplicate = true;
      continue;
    }
    used.add(id);
    rated.push({ id, stars: byId.get(id)!.stars });
  }
  const out = deckProblems(rated).filter((p) => p !== 'size' && p !== 'duplicate');
  return duplicate ? ['duplicate', ...out] : out;
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
