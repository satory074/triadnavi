import type { MatchEvent, MatchSetup } from './match';
import { parseCard, sameCard } from './presets';
import { rulesFromIds } from './rules';
import type { CardDef, Player } from './types';

/** アプリ全体の状態。ブラウザに保存し、再読み込みで対局を失わないようにする */

export interface SetupDraft {
  npcId: number | null;
  /** 有効なルール(ゲームデータのルール ID)。エンジンに関係する 11 種のみ */
  ruleIds: number[];
  fallenAceInCombo: boolean;
  myCards: (CardDef | null)[];
  /** 相手の 5 スロット。分かっているカード、または null(不明) */
  oppCards: (CardDef | null)[];
  /** 不明スロットに入りうる候補 */
  oppPool: CardDef[];
  first: Player;
  oppOrderKnown: boolean;
  /** 候補が不明な時の相手の強さの想定 */
  priorLevel: 1 | 2 | 3;
}

export interface AppState {
  phase: 'setup' | 'play';
  draft: SetupDraft;
  setup: MatchSetup | null;
  events: MatchEvent[];
}

export const EMPTY_DRAFT: SetupDraft = {
  npcId: null,
  ruleIds: [],
  fallenAceInCombo: true,
  myCards: [null, null, null, null, null],
  oppCards: [null, null, null, null, null],
  oppPool: [],
  first: 0,
  oppOrderKnown: false,
  priorLevel: 2,
};

export const INITIAL_STATE: AppState = { phase: 'setup', draft: EMPTY_DRAFT, setup: null, events: [] };

/** エンジンの挙動に関係するルール ID(チップとして選べるもの) */
export const SELECTABLE_RULE_IDS: readonly number[] = [2, 3, 4, 6, 10, 11, 12, 13, 8, 9, 5];

const EXCLUSIVE: readonly (readonly [number, number])[] = [[2, 3], [8, 9], [12, 13]];

/** ルールのチップを切り替える。公式に排他の 3 組は、片方を選ぶともう片方が外れる */
export function toggleRule(ids: readonly number[], id: number): number[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  const pair = EXCLUSIVE.find((p) => p.includes(id));
  const other = pair ? (pair[0] === id ? pair[1] : pair[0]) : -1;
  return [...ids.filter((x) => x !== other), id];
}

export interface NpcLike {
  id: number;
  fixed: CardDef[];
  variable: CardDef[];
  rules: number[];
}

/** NPC を選んだ時: 固定カードは必ず手札にあるので既知、残りは不明スロット + 可変プール */
export function applyNpc(draft: SetupDraft, npc: NpcLike, learned: readonly CardDef[]): SetupDraft {
  const fixed = npc.fixed.slice(0, 5);
  const oppCards: (CardDef | null)[] = [...fixed, ...Array<null>(5 - fixed.length).fill(null)];
  const pool = [...npc.variable, ...learned.filter((c) => ![...npc.fixed, ...npc.variable].some((k) => sameCard(k, c)))];
  let ruleIds: number[] = [];
  for (const id of npc.rules) if (SELECTABLE_RULE_IDS.includes(id) && !ruleIds.includes(id)) ruleIds = toggleRule(ruleIds, id);
  return { ...draft, npcId: npc.id, oppCards, oppPool: pool, ruleIds, oppOrderKnown: false };
}

export function clearNpc(draft: SetupDraft): SetupDraft {
  return { ...draft, npcId: null, oppCards: [null, null, null, null, null], oppPool: [], ruleIds: [] };
}

/** 候補のカードが「手札に見えている」時: 候補から最初の不明スロットへ移す */
export function revealPoolCard(draft: SetupDraft, poolIndex: number): SetupDraft {
  const slot = draft.oppCards.indexOf(null);
  const card = draft.oppPool[poolIndex];
  if (slot < 0 || !card) return draft;
  const oppCards = draft.oppCards.slice();
  oppCards[slot] = card;
  return { ...draft, oppCards, oppPool: draft.oppPool.filter((_, i) => i !== poolIndex) };
}

/** スロットのカードを外す。toPool が true なら候補へ戻す */
export function clearOppSlot(draft: SetupDraft, slot: number, toPool: boolean): SetupDraft {
  const card = draft.oppCards[slot];
  if (!card) return draft;
  const oppCards = draft.oppCards.slice();
  oppCards[slot] = null;
  return { ...draft, oppCards, oppPool: toPool ? [...draft.oppPool, card] : draft.oppPool };
}

export type SetupProblem = 'myHandIncomplete';

export function setupProblems(draft: SetupDraft): SetupProblem[] {
  return draft.myCards.some((c) => c === null) ? ['myHandIncomplete'] : [];
}

/** 設定の注意点(対戦は始められるが、結果の質が落ちる) */
export function setupWarnings(draft: SetupDraft): string[] {
  const out: string[] = [];
  const unknown = draft.oppCards.filter((c) => c === null).length;
  const rules = rulesFromIds(draft.ruleIds);
  if (rules.open === 'all' && unknown > 0) out.push('オールオープンなら相手の 5 枚が全て見えています。全部入れると結果が「確定」になります。');
  if (rules.open === 'three' && unknown > 2) out.push('スリーオープンなら相手の 3 枚が見えています。見えているカードを入れてください。');
  if (unknown > 0 && draft.oppPool.length < unknown) out.push('相手の候補カードが足りないため、結果は「推定」になります。');
  return out;
}

export function draftToSetup(draft: SetupDraft): MatchSetup | null {
  if (setupProblems(draft).length > 0) return null;
  return {
    rules: rulesFromIds(draft.ruleIds),
    options: { fallenAceInCombo: draft.fallenAceInCombo },
    myHand: draft.myCards as CardDef[],
    // 分かっているカードを前に詰める(オーダーで相手の並び順を使う時は入力順がそのまま並び順)
    oppSlots: [...draft.oppCards.filter((c) => c !== null), ...draft.oppCards.filter((c) => c === null)],
    oppPool: draft.oppPool,
    first: draft.first,
    round: 0,
    oppOrderKnown: draft.oppOrderKnown,
    npcId: draft.npcId ?? undefined,
  };
}

function parseSlots(x: unknown): (CardDef | null)[] {
  const arr = Array.isArray(x) ? x : [];
  return Array.from({ length: 5 }, (_, i) => parseCard(arr[i]));
}

function parseDraft(x: unknown): SetupDraft {
  if (typeof x !== 'object' || x === null) return EMPTY_DRAFT;
  const o = x as Record<string, unknown>;
  const ruleIds = Array.isArray(o.ruleIds) ? o.ruleIds.filter((id): id is number => SELECTABLE_RULE_IDS.includes(id as number)) : [];
  return {
    npcId: Number.isInteger(o.npcId) ? (o.npcId as number) : null,
    ruleIds: ruleIds.reduce<number[]>((acc, id) => (acc.includes(id) ? acc : toggleRule(acc, id)), []),
    fallenAceInCombo: o.fallenAceInCombo !== false,
    myCards: parseSlots(o.myCards),
    oppCards: parseSlots(o.oppCards),
    oppPool: (Array.isArray(o.oppPool) ? o.oppPool : []).map(parseCard).filter((c): c is CardDef => c !== null).slice(0, 20),
    first: o.first === 1 ? 1 : 0,
    oppOrderKnown: o.oppOrderKnown === true,
    priorLevel: o.priorLevel === 1 || o.priorLevel === 3 ? o.priorLevel : 2,
  };
}

/**
 * 保存された状態を読む。イベントの中身の検証は replay に委ねる(壊れたイベント以降は捨てられる)。
 * 対局中の setup は、下書きから作り直せない(サドンデス再戦で変わる)ので、そのまま検証して使う。
 */
export function parseAppState(raw: string | null): AppState {
  if (!raw) return INITIAL_STATE;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const draft = parseDraft(o.draft);
    const s = o.setup as Record<string, unknown> | null | undefined;
    if (o.phase !== 'play' || !s || typeof s !== 'object') return { ...INITIAL_STATE, draft };
    const myHand = (Array.isArray(s.myHand) ? s.myHand : []).map(parseCard);
    const oppSlots = Array.isArray(s.oppSlots) ? s.oppSlots.map(parseCard) : [];
    if (myHand.length !== 5 || myHand.some((c) => c === null) || oppSlots.length !== 5) return { ...INITIAL_STATE, draft };
    const base = draftToSetup({ ...draft, myCards: myHand });
    if (!base) return { ...INITIAL_STATE, draft };
    const setup: MatchSetup = {
      ...base,
      rules: { ...base.rules, ...(typeof s.rules === 'object' && s.rules !== null ? (s.rules as MatchSetup['rules']) : {}) },
      myHand: myHand as CardDef[],
      oppSlots,
      oppPool: (Array.isArray(s.oppPool) ? s.oppPool : []).map(parseCard).filter((c): c is CardDef => c !== null),
      first: s.first === 1 ? 1 : 0,
      round: Number.isInteger(s.round) ? Math.max(0, s.round as number) : 0,
      oppOrderKnown: s.oppOrderKnown === true,
    };
    return { phase: 'play', draft, setup, events: Array.isArray(o.events) ? (o.events as MatchEvent[]) : [] };
  } catch {
    return INITIAL_STATE;
  }
}
