import type { Matchup } from './deckEval';
import type { HandPrior, PriorLevel } from './handPrior';
import { replay, type MatchEvent, type MatchSetup } from './match';
import { parseCard, sameCard } from './presets';
import { RULE_ID, rulesFromIds } from './rules';
import type { CardDef, Player } from './types';

/** アプリ全体の状態。ブラウザに保存し、再読み込みで対局を失わないようにする */

/** 対戦の種類: 通常(NPC 戦・対人戦) / 大会(ランキング形式) / オフィシャルトーナメント(ドラフト) */
export type MatchMode = 'free' | 'tournament' | 'open';

/** 対戦記録の対象になる対戦の種類(通常モードは記録しない) */
export type RecordedMode = Exclude<MatchMode, 'free'>;

export interface SetupDraft {
  mode: MatchMode;
  /** 大会(ゲームデータ TripleTriadCompetition の行 ID)。mode が 'tournament' の時だけ意味を持つ */
  tournamentId: number | null;
  /** オフィシャルトーナメントのルール(ゲームデータ TripleTriadTournament の行 ID)。mode が 'open' の時だけ */
  openRulesetId: number | null;
  npcId: number | null;
  /** 有効なルール(ゲームデータのルール ID)。エンジンに関係する 11 種のみ */
  ruleIds: number[];
  /**
   * スワップ(ルール ID 14)。対戦開始時に 1 枚交換されるルールで、エンジン(RuleSet)には効かず、デッキの評価にだけ効く。
   * rulesFromIds / ruleIdsOf が 14 を扱わないので ruleIds には入れられない(changeRules と parseDraft で黙って消える)
   */
  swap: boolean;
  fallenAceInCombo: boolean;
  myCards: (CardDef | null)[];
  /** 相手の 5 スロット。分かっているカード、または null(不明) */
  oppCards: (CardDef | null)[];
  /** 不明スロットに入りうる候補 */
  oppPool: CardDef[];
  first: Player;
  oppOrderKnown: boolean;
  /** 候補が不明な時の相手の強さの想定(通常モード。大会とドラフトでは handPriorOf が別の想定を返す) */
  priorLevel: PriorLevel;
}

export interface AppState {
  phase: 'setup' | 'play';
  draft: SetupDraft;
  setup: MatchSetup | null;
  events: MatchEvent[];
  /** 対戦記録(core/history.ts)の entry の id。記録しない対局(通常モード、まだ 1 件も記録していない)は null */
  historyId: string | null;
}

export const EMPTY_DRAFT: SetupDraft = {
  mode: 'free',
  tournamentId: null,
  openRulesetId: null,
  npcId: null,
  ruleIds: [],
  swap: false,
  fallenAceInCombo: true,
  myCards: [null, null, null, null, null],
  oppCards: [null, null, null, null, null],
  oppPool: [],
  first: 0,
  oppOrderKnown: false,
  priorLevel: 2,
};

export const INITIAL_STATE: AppState = { phase: 'setup', draft: EMPTY_DRAFT, setup: null, events: [], historyId: null };

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

/** ルール ID の一覧を、チップで選べるものだけ排他を解決して畳む */
export function selectableRules(ids: readonly number[]): number[] {
  let out: number[] = [];
  for (const id of ids) if (SELECTABLE_RULE_IDS.includes(id) && !out.includes(id)) out = toggleRule(out, id);
  return out;
}

/**
 * NPC を選んだ時: 固定カードは必ず手札にあるので既知、残りは不明スロット + 可変プール。
 * 大会モードでは対戦は大会のルールで行われる(NPC 固有のルールは使わない)ので、ルールは変えない
 */
export function applyNpc(draft: SetupDraft, npc: NpcLike, learned: readonly CardDef[]): SetupDraft {
  const fixed = npc.fixed.slice(0, 5);
  const oppCards: (CardDef | null)[] = [...fixed, ...Array<null>(5 - fixed.length).fill(null)];
  const pool = [...npc.variable, ...learned.filter((c) => ![...npc.fixed, ...npc.variable].some((k) => sameCard(k, c)))];
  const tournament = draft.mode === 'tournament';
  const ruleIds = tournament ? draft.ruleIds : selectableRules(npc.rules);
  const swap = tournament ? draft.swap : npc.rules.includes(RULE_ID.swap);
  return { ...draft, npcId: npc.id, oppCards, oppPool: pool, ruleIds, swap, oppOrderKnown: false };
}

/** NPC を外す。大会モードではルールは大会のものなので残す */
export function clearNpc(draft: SetupDraft): SetupDraft {
  const tournament = draft.mode === 'tournament';
  return { ...draft, npcId: null, oppCards: [null, null, null, null, null], oppPool: [], ruleIds: tournament ? draft.ruleIds : [], swap: tournament ? draft.swap : false };
}

export interface TournamentLike {
  id: number;
  /** 大会の固定ルール(ゲームデータのルール ID。ルーレットが 2 つの大会は [1, 1]) */
  rules: number[];
}

/** 大会を選んだ時: ルールは大会の固定ルール。相手(NPC か不明のプレイヤー)はそのまま */
export function applyTournament(draft: SetupDraft, t: TournamentLike): SetupDraft {
  return { ...draft, mode: 'tournament', tournamentId: t.id, openRulesetId: null, ruleIds: selectableRules(t.rules), swap: t.rules.includes(RULE_ID.swap) };
}

/** オフィシャルトーナメントのルールを選んだ時。相手は必ずドラフトの手札(不明)なので、NPC と相手の手札は消す */
export function applyOpenRuleset(draft: SetupDraft, r: TournamentLike): SetupDraft {
  return { ...clearNpc({ ...draft, mode: 'free' }), mode: 'open', openRulesetId: r.id, tournamentId: null, ruleIds: selectableRules(r.rules), swap: r.rules.includes(RULE_ID.swap) };
}

/** 対戦の種類を切り替える。通常に戻す時は大会の選択を忘れる(ルールと相手はそのまま残す) */
export function setMode(draft: SetupDraft, mode: MatchMode): SetupDraft {
  if (mode === draft.mode) return draft;
  if (mode === 'free') return { ...draft, mode, tournamentId: null, openRulesetId: null };
  if (mode === 'open') return { ...clearNpc({ ...draft, mode: 'free' }), mode, tournamentId: null };
  return { ...draft, mode, openRulesetId: null };
}

/** 相手の裏向きの手札の想定。大会の相手は強いデッキ、ドラフトの相手はドラフトの手札、それ以外は 3 段階の想定 */
export function handPriorOf(draft: SetupDraft): HandPrior {
  if (draft.mode === 'open') return { kind: 'draft' };
  if (draft.mode === 'tournament' && draft.npcId === null) return { kind: 'meta' };
  return { kind: 'level', level: draft.priorLevel };
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
  if (unknown > 0 && draft.oppPool.length < unknown) {
    const prior = handPriorOf(draft);
    out.push(prior.kind === 'level' ? '相手の候補カードが足りないため、結果は「推定」になります。' : '相手のデッキが分からないため、結果は想定した手札で解いた「推定」になります。');
  }
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

/** 対戦記録の対象か。対象を広げる時(通常モードも記録するなど)はここだけ変える */
export function recordedMode(draft: SetupDraft): RecordedMode | null {
  return draft.mode === 'free' ? null : draft.mode;
}

/**
 * 対局の記録(events)を置き換える。記録する対局で最初のイベントが入った時(0 件 → 1 件以上、1 局目)に対戦記録の id を付ける。
 * 「対戦を始める」ではなく最初のイベントで付けるのは、toTop が開くたびに下書きから対局を作るため(1 枚も置かない対局の空の記録を増やさない)。
 * 記録を消した対局は events が既に 1 件以上あるので付け直さない。nextId は更新関数の外で作って渡す(core は乱数を読まない)
 */
export function setEvents(state: AppState, events: MatchEvent[], nextId: string): AppState {
  const fresh = state.historyId === null && recordedMode(state.draft) !== null && state.events.length === 0 && events.length > 0 && (state.setup?.round ?? 0) === 0;
  return { ...state, events, historyId: fresh ? nextId : state.historyId };
}

/**
 * トップ(起動時とロゴ)は対局画面。対局中ならそのまま(記録を消さない)、そうでなければ下書きから新しい対局を始める。
 * 自分の手札が揃っていない(初めて開いた時など)なら、対局を作れないので設定画面。
 */
export function toTop(state: AppState): AppState {
  if (state.phase === 'play' && state.setup) return state;
  const setup = draftToSetup(state.draft);
  return setup ? { ...state, phase: 'play', setup, events: [], historyId: null } : { ...state, phase: 'setup', setup: null, events: [], historyId: null };
}

/**
 * 「はじめから」: 同じ設定の最初の対局に戻す。対局中は下書きを変えられないので、下書きは 1 局目の設定のまま。
 * サドンデスの再戦で組み直した手札と回数は捨てる。
 */
export function restartMatch(state: AppState): AppState {
  const setup = draftToSetup(state.draft) ?? state.setup;
  // 終局後(「同じ相手ともう一戦」)は別の対戦なので対戦記録の id を外す。途中の「はじめから」は同じ対戦のやり直しなので保つ
  const finished = state.setup !== null && replay(state.setup, state.events).finished;
  return { ...state, phase: 'play', setup, events: [], historyId: finished ? null : state.historyId };
}

/**
 * 対局中にルールを変える(対局画面の「ルールを変更」)。記録(events)はそのまま残し、置いたカードは
 * replay() が新しいルールで計算し直す。replay() の検証(手番・マス・手札)はルールに依らないので、記録が途中で切れることはない。
 * 下書きにも同じ値を書く: 「はじめから」(restartMatch)は下書きから setup を作り直し、再読み込み(parseAppState)は
 * options を下書きから作り直すので、setup だけ変えると元のルールに戻ってしまう。
 */
export function changeRules(state: AppState, ruleIds: readonly number[], fallenAceInCombo: boolean): AppState {
  const ids = ruleIds.filter((id) => SELECTABLE_RULE_IDS.includes(id));
  const setup = state.setup && { ...state.setup, rules: rulesFromIds(ids), options: { ...state.setup.options, fallenAceInCombo } };
  return { ...state, draft: { ...state.draft, ruleIds: ids, fallenAceInCombo }, setup };
}

/**
 * デッキの評価に使う対戦条件。ルーレットは下書きのルールには入らない(対戦が始まってから決まる)ので、
 * 対戦前に決まっているルール(大会 / オフィシャルトーナメント / NPC の固定ルール)から本数を受け取る。どれも無ければ空でよい。
 * スワップは下書きの swap(ルールのチップで切り替えられる。NPC / 大会を選ぶと自動で入る)から取る。
 * 候補が足りない分は handPriorOf の想定で埋める(oppPrior。代表カード oppRef は同梱データを持つ UI 側が足す)。
 */
export function matchupFromDraft(draft: SetupDraft, preMatchRules: readonly number[]): Matchup {
  const oppKnown = draft.oppCards.filter((c): c is CardDef => c !== null);
  const oppUnknown = 5 - oppKnown.length;
  return {
    ruleIds: draft.ruleIds,
    options: { fallenAceInCombo: draft.fallenAceInCombo },
    oppKnown,
    oppPool: draft.oppPool,
    oppUnknown,
    roulette: preMatchRules.filter((id) => id === RULE_ID.roulette).length,
    swap: draft.swap,
    ...(oppUnknown > draft.oppPool.length ? { oppPrior: handPriorOf(draft) } : {}),
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
  const id = (x: unknown) => (Number.isInteger(x) && (x as number) > 0 ? (x as number) : null);
  return {
    mode: o.mode === 'tournament' || o.mode === 'open' ? o.mode : 'free',
    tournamentId: id(o.tournamentId),
    openRulesetId: id(o.openRulesetId),
    npcId: Number.isInteger(o.npcId) ? (o.npcId as number) : null,
    ruleIds: ruleIds.reduce<number[]>((acc, id) => (acc.includes(id) ? acc : toggleRule(acc, id)), []),
    swap: o.swap === true,
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
 * 保存された setup を検証して読む。手札 5 枚と相手の 5 スロットが揃っていなければ null。
 * rules / options は base の上に保存された値を重ねる(欠けた項目は base)。npcId は保存値が整数ならそれ、無ければ base。
 * 対局中の保存(parseAppState)と対戦記録(parseHistory)が同じ経路を通る
 */
export function parseSetup(x: unknown, base: Pick<MatchSetup, 'rules' | 'options' | 'npcId'>): MatchSetup | null {
  if (typeof x !== 'object' || x === null) return null;
  const s = x as Record<string, unknown>;
  const myHand = (Array.isArray(s.myHand) ? s.myHand : []).map(parseCard);
  const oppSlots = Array.isArray(s.oppSlots) ? s.oppSlots.map(parseCard) : [];
  if (myHand.length !== 5 || myHand.some((c) => c === null) || oppSlots.length !== 5) return null;
  const options = typeof s.options === 'object' && s.options !== null ? (s.options as Record<string, unknown>) : {};
  const npcId = Number.isInteger(s.npcId) ? (s.npcId as number) : base.npcId;
  return {
    rules: { ...base.rules, ...(typeof s.rules === 'object' && s.rules !== null ? (s.rules as MatchSetup['rules']) : {}) },
    options: { ...base.options, ...(typeof options.fallenAceInCombo === 'boolean' ? { fallenAceInCombo: options.fallenAceInCombo } : {}) },
    myHand: myHand as CardDef[],
    oppSlots,
    oppPool: (Array.isArray(s.oppPool) ? s.oppPool : []).map(parseCard).filter((c): c is CardDef => c !== null),
    first: s.first === 1 ? 1 : 0,
    round: Number.isInteger(s.round) ? Math.max(0, s.round as number) : 0,
    oppOrderKnown: s.oppOrderKnown === true,
    ...(npcId !== undefined ? { npcId } : {}),
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
    if (o.phase !== 'play') return { ...INITIAL_STATE, draft };
    const setup = parseSetup(o.setup, { rules: rulesFromIds(draft.ruleIds), options: { fallenAceInCombo: draft.fallenAceInCombo }, npcId: draft.npcId ?? undefined });
    if (!setup) return { ...INITIAL_STATE, draft };
    const historyId = typeof o.historyId === 'string' && o.historyId !== '' ? o.historyId : null;
    return { phase: 'play', draft, setup, events: Array.isArray(o.events) ? (o.events as MatchEvent[]) : [], historyId };
  } catch {
    return INITIAL_STATE;
  }
}
