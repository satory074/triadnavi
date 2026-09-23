import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, draftToSetup } from './appState';
import { EMPTY_HISTORY, MAX_HISTORY, entryOutcome, parseHistory, rematchCount, removeEntry, syncGame, tally, type HistoryGame, type MatchHistory } from './history';
import type { CardDef } from './types';

const c = (n: number): CardDef => ({ sides: [n, n, n, n], type: 0 });
const setup = draftToSetup({ ...EMPTY_DRAFT, myCards: [c(1), c(2), c(3), c(4), c(5)], oppCards: [c(6), c(7), null, null, null], oppPool: [c(8)] })!;
const meta = { mode: 'tournament' as const, tournamentId: 1, openRulesetId: null };
const open = { mode: 'open' as const, tournamentId: null, openRulesetId: 2 };
const game = (round: number, outcome: HistoryGame['outcome'] = null): HistoryGame => ({
  setup: { ...setup, round },
  events: [{ t: 'place', by: 0, card: { from: 'my', index: 0 }, cell: 4 }],
  outcome,
  score: outcome ? { me: 6, opp: 4 } : null,
});

describe('対戦記録', () => {
  it('保存した形で往復でき、壊れた入力は既定値、壊れた 1 件だけ捨てる', () => {
    const h = syncGame(syncGame(EMPTY_HISTORY, 'a', meta, game(0, 'win'), 1000), 'b', open, game(0), 2000);
    expect(parseHistory(JSON.stringify(h))).toEqual(h);
    for (const raw of [null, '', 'not json', '[]', '{"entries":"x"}']) expect(parseHistory(raw)).toEqual(EMPTY_HISTORY);
    const broken = { entries: [h.entries[0], { id: 'c', startedAt: 3, mode: 'tournament', games: [] }, { ...h.entries[1], games: [{ setup: { myHand: [] } }] }] };
    expect(parseHistory(JSON.stringify(broken)).entries.map((e) => e.id)).toEqual(['a']);
  });

  it('同じ対局の同期は同じ結果になり、startedAt は最初の記録のまま', () => {
    const once = syncGame(EMPTY_HISTORY, 'a', meta, game(0), 1000);
    const twice = syncGame(once, 'a', meta, game(0), 5000);
    expect(twice).toEqual(once);
    const done = syncGame(twice, 'a', meta, game(0, 'win'), 9000);
    expect(done.entries).toHaveLength(1);
    expect(done.entries[0].startedAt).toBe(1000);
  });

  it('再戦は round の位置に入り、1 局目の同期で後ろの再戦が落ちる', () => {
    let h = syncGame(EMPTY_HISTORY, 'a', meta, game(0, 'draw'), 1);
    h = syncGame(h, 'a', meta, game(1, 'win'), 2);
    expect(h.entries[0].games.map((g) => g.setup.round)).toEqual([0, 1]);
    expect(entryOutcome(h.entries[0])).toBe('win');
    expect(rematchCount(h.entries[0])).toBe(1);
    h = syncGame(h, 'a', meta, game(0), 3); // 「はじめから」
    expect(h.entries[0].games.map((g) => g.setup.round)).toEqual([0]);
    expect(entryOutcome(h.entries[0])).toBeNull();
  });

  it('上限を超えると古いものから落ちる', () => {
    let h: MatchHistory = EMPTY_HISTORY;
    for (let i = 0; i < MAX_HISTORY + 3; i++) h = syncGame(h, `e${i}`, meta, game(0), i);
    expect(h.entries).toHaveLength(MAX_HISTORY);
    expect(h.entries[0].id).toBe('e3');
    expect(removeEntry(h, 'e3').entries.map((e) => e.id)).not.toContain('e3');
  });

  it('集計は未完を除き、大会ごとに 勝/分/負 を数える', () => {
    let h = syncGame(EMPTY_HISTORY, 'a', open, game(0, 'draw'), 1);
    h = syncGame(h, 'b', meta, game(0, 'win'), 2);
    h = syncGame(h, 'c', meta, game(0, 'loss'), 3);
    h = syncGame(h, 'd', meta, game(0), 4); // 未完
    expect(tally(h.entries)).toEqual([
      { ...meta, win: 1, draw: 0, loss: 1 },
      { ...open, win: 0, draw: 1, loss: 0 },
    ]);
  });
});
