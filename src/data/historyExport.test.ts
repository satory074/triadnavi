import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, draftToSetup } from '../core/appState';
import { EMPTY_HISTORY, syncGame, type HistoryGame } from '../core/history';
import type { CardDef } from '../core/types';
import { TSV_COLUMNS, entryRuleIds, historyTsv, opponentLabel } from './historyExport';

const c = (n: number, label?: string): CardDef => ({ sides: [n, n, n, n], type: 0, ...(label ? { label } : {}) });

describe('対戦記録の書き出し', () => {
  it('TSV は見出し + 1 行 1 対戦で、欄の中のタブと改行が列をずらさない', () => {
    // 手入力のカード名にタブと改行が入っていても列が増えない
    const draft = { ...EMPTY_DRAFT, mode: 'tournament' as const, tournamentId: 4, npcId: 1, myCards: [c(1, 'A\tB'), c(2, 'C\nD'), c(3), c(4), c(5)] };
    const game: HistoryGame = { setup: draftToSetup(draft)!, events: [], outcome: 'win', score: { me: 6, opp: 4 } };
    let h = syncGame(EMPTY_HISTORY, 'a', { mode: 'tournament', tournamentId: 4, openRulesetId: null }, game, 0);
    h = syncGame(h, 'b', { mode: 'open', tournamentId: null, openRulesetId: 2 }, { ...game, outcome: null, score: null }, 1);
    const lines = historyTsv(h.entries).split('\n');
    expect(lines).toHaveLength(h.entries.length + 1);
    for (const line of lines) expect(line.split('\t')).toHaveLength(TSV_COLUMNS.length);
    // ルーレット 2 つの大会でも同じルールを 2 回出さず、ドラフトの相手は NPC ではない
    expect(entryRuleIds(h.entries[0]).filter((id) => id === 1)).toHaveLength(1);
    expect(opponentLabel(h.entries[1])).toBe('ドラフトの相手');
  });
});
