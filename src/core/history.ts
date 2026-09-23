import { parseSetup, type RecordedMode } from './appState';
import type { MatchEvent, MatchSetup } from './match';
import { DEFAULT_OPTIONS, NO_RULES, type Outcome } from './types';

/**
 * 対戦記録。大会とオフィシャルトーナメントの対局を、対局の記録(setup + events)ごと残す。
 * 1 entry = 1 対戦(サドンデスの再戦を含む)。games[i] が setup.round === i の対局で、入力したデッキは games[0].setup.myHand、
 * 対戦の結果は最後の game。相手(npcId)とルールは entry に二重に持たず、各 game の setup から導く(対局中の「ルールを変更」で
 * setup.rules が変わる)。対局の状態(triadnavi:state:v1)とは別のキーに保存する。
 */

export interface HistoryGame {
  setup: MatchSetup;
  /** replay で再生できた分だけ(applied まで) */
  events: MatchEvent[];
  /** replay の結果。未完なら null */
  outcome: Outcome | null;
  score: { me: number; opp: number } | null;
}

export interface HistoryMeta {
  mode: RecordedMode;
  tournamentId: number | null;
  openRulesetId: number | null;
}

export interface HistoryEntry extends HistoryMeta {
  id: string;
  /** 最初に記録した時刻(ms) */
  startedAt: number;
  /** round の昇順。games[i].setup.round === i */
  games: HistoryGame[];
}

/** 古い順(末尾が最新)。画面では逆順に出す */
export interface MatchHistory {
  entries: HistoryEntry[];
}

export const EMPTY_HISTORY: MatchHistory = { entries: [] };

/**
 * 件数の上限。1 件 ≈ 2 KB(候補 20 枚 + 再戦で最大 8 KB)で、1 手ごとに全体を JSON にして書く。
 * github.io は他のプロジェクトと localStorage 5 MB を共有するので歯止めを置く。超えたら古いものから落とす
 */
export const MAX_HISTORY = 200;

/**
 * 対局の分を書き直す。id の entry が無ければ作り(startedAt = now)、あれば同じ round の game を置き換えて、それより後の再戦を落とす
 * (途中の「はじめから」で round 0 に戻った時に、前の再戦が残らないように)。entry の meta と startedAt は最初の記録のまま。
 * 同じ入力なら同じ結果(StrictMode の 2 回実行、再読み込み直後の実行で増えない)
 */
export function syncGame(history: MatchHistory, id: string, meta: HistoryMeta, game: HistoryGame, now: number): MatchHistory {
  const i = history.entries.findIndex((e) => e.id === id);
  if (i < 0) {
    const entry: HistoryEntry = { id, startedAt: now, ...meta, games: [game] };
    return { entries: [...history.entries, entry].slice(-MAX_HISTORY) };
  }
  const prev = history.entries[i];
  const entries = history.entries.slice();
  entries[i] = { ...prev, games: [...prev.games.filter((g) => g.setup.round < game.setup.round), game] };
  return { entries };
}

export function removeEntry(history: MatchHistory, id: string): MatchHistory {
  return { entries: history.entries.filter((e) => e.id !== id) };
}

/** 対戦の結果 = 最後の対局(サドンデスの再戦があればその結果)。未完なら null */
export function entryOutcome(entry: HistoryEntry): Outcome | null {
  return entry.games[entry.games.length - 1]?.outcome ?? null;
}

/** サドンデスの再戦の回数 */
export function rematchCount(entry: HistoryEntry): number {
  return entry.games.length - 1;
}

export interface HistoryTally extends HistoryMeta {
  win: number;
  draw: number;
  loss: number;
}

const MODE_ORDER: readonly RecordedMode[] = ['tournament', 'open'];

/** 大会(ルールの組)ごとの 勝/分/負。未完の対戦は数えない。並びは 大会 → オフィシャルトーナメント、その中は id 順 */
export function tally(entries: readonly HistoryEntry[]): HistoryTally[] {
  const out: HistoryTally[] = [];
  for (const e of entries) {
    const outcome = entryOutcome(e);
    if (!outcome) continue;
    let t = out.find((x) => x.mode === e.mode && x.tournamentId === e.tournamentId && x.openRulesetId === e.openRulesetId);
    if (!t) {
      t = { mode: e.mode, tournamentId: e.tournamentId, openRulesetId: e.openRulesetId, win: 0, draw: 0, loss: 0 };
      out.push(t);
    }
    t[outcome]++;
  }
  return out.sort((a, b) => MODE_ORDER.indexOf(a.mode) - MODE_ORDER.indexOf(b.mode) || (a.tournamentId ?? 0) - (b.tournamentId ?? 0) || (a.openRulesetId ?? 0) - (b.openRulesetId ?? 0));
}

function parseGame(x: unknown): HistoryGame | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  // rules が欠けていれば追加ルールなし(parseAppState と同じ緩さ)。イベントの中身の検証は replay に委ねる
  const setup = parseSetup(o.setup, { rules: NO_RULES, options: DEFAULT_OPTIONS });
  if (!setup) return null;
  const outcome = o.outcome === 'win' || o.outcome === 'draw' || o.outcome === 'loss' ? o.outcome : null;
  const sc = typeof o.score === 'object' && o.score !== null ? (o.score as Record<string, unknown>) : null;
  const score = sc && Number.isInteger(sc.me) && Number.isInteger(sc.opp) ? { me: sc.me as number, opp: sc.opp as number } : null;
  return { setup, events: Array.isArray(o.events) ? (o.events as MatchEvent[]) : [], outcome, score };
}

function parseEntry(x: unknown): HistoryEntry | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id === '' || typeof o.startedAt !== 'number' || !Number.isFinite(o.startedAt)) return null;
  if (o.mode !== 'tournament' && o.mode !== 'open') return null;
  const id = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
  const games = (Array.isArray(o.games) ? o.games : []).map(parseGame);
  if (games.length === 0 || !games.every((g): g is HistoryGame => g !== null)) return null;
  if (games.some((g, i) => i > 0 && g.setup.round <= games[i - 1].setup.round)) return null;
  return { id: o.id, startedAt: o.startedAt, mode: o.mode, tournamentId: id(o.tournamentId), openRulesetId: id(o.openRulesetId), games };
}

/** 保存された対戦記録を読む。壊れた entry はその 1 件だけ捨てる。id の重複は先勝ち */
export function parseHistory(raw: string | null): MatchHistory {
  if (!raw) return EMPTY_HISTORY;
  try {
    const o = JSON.parse(raw) as { entries?: unknown } | null;
    if (typeof o !== 'object' || o === null || !Array.isArray(o.entries)) return EMPTY_HISTORY;
    const seen = new Set<string>();
    const entries: HistoryEntry[] = [];
    for (const x of o.entries) {
      const e = parseEntry(x);
      if (!e || seen.has(e.id)) continue;
      seen.add(e.id);
      entries.push(e);
    }
    return { entries: entries.slice(-MAX_HISTORY) };
  } catch {
    return EMPTY_HISTORY;
  }
}
