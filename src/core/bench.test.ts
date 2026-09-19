import { describe, expect, it } from 'vitest';
import { FastBoard } from './fastEngine';
import { makeRng } from './rng';
import { toRuleBits } from './rules';
import { countMistakes, legalMoves, negamax, probeMove, probeRoot, searchStats } from './search';
import { NO_RULES, type CardDef } from './types';

// `npm run bench` で有効化。性能予算の判断材料にする(通常のテスト実行では走らない)
const enabled = Boolean(import.meta.env.VITE_BENCH);

function timed<T>(f: () => T): { ms: number; nodes: number; value: T } {
  searchStats.nodes = 0;
  const t0 = performance.now();
  const value = f();
  return { ms: performance.now() - t0, nodes: searchStats.nodes, value };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe.skipIf(!enabled)('ベンチマーク: 空の盤面・自分が先攻', () => {
  it('セイム+プラス有効', () => {
    const r = makeRng(42);
    const rows: Record<string, number[]> = { full: [], win: [], draw: [], member: [], mistakes: [], nodes: [] };
    for (let i = 0; i < 8; i++) {
      const cards: CardDef[] = Array.from({ length: 10 }, () => ({
        sides: [1 + Math.floor(r() * 10), 1 + Math.floor(r() * 10), 1 + Math.floor(r() * 10), 1 + Math.floor(r() * 10)],
        type: 0,
      }));
      const b = new FastBoard({
        cards,
        myHand: [0, 1, 2, 3, 4],
        oppKnown: [5, 6, 7, 8, 9],
        oppPool: [],
        poolQuota: 0,
        board: Array(9).fill(null),
        turn: 0,
        first: 0,
        ruleBits: toRuleBits({ ...NO_RULES, same: true, plus: true }, { fallenAceInCombo: true }),
        sign: 0,
        orderMe: false,
        orderOpp: false,
      });
      const moves = legalMoves(b);
      const full = timed(() => negamax(b, -99, 99));
      const win = timed(() => probeRoot(b, moves, 1));
      const draw = timed(() => probeRoot(b, moves, 0));
      const thr = win.value ? 1 : draw.value ? 0 : -5;
      const member = timed(() => moves.filter((m) => probeMove(b, m, thr)));
      const members = member.value;
      const mist = timed(() => members.slice(0, 5).map((m) => countMistakes(b, m, thr < 0)));
      rows.full.push(full.ms);
      rows.nodes.push(full.nodes);
      rows.win.push(win.ms);
      rows.draw.push(draw.ms);
      rows.member.push(member.ms);
      rows.mistakes.push((mist.ms / Math.max(1, Math.min(5, members.length))) * members.length);
      console.log(
        `#${i} value=${full.value} full=${full.ms.toFixed(0)}ms/${full.nodes} nodes  win?=${win.ms.toFixed(0)}ms  draw?=${draw.ms.toFixed(0)}ms  ` +
          `members=${members.length}/${moves.length} in ${member.ms.toFixed(0)}ms  mistakes(推定・全メンバー)=${rows.mistakes[i].toFixed(0)}ms`,
      );
    }
    console.log(
      `中央値: full=${median(rows.full).toFixed(0)}ms (${median(rows.nodes)} nodes) win?=${median(rows.win).toFixed(0)}ms ` +
        `draw?=${median(rows.draw).toFixed(0)}ms member=${median(rows.member).toFixed(0)}ms mistakes=${median(rows.mistakes).toFixed(0)}ms`,
    );
    expect(rows.full.length).toBe(8);
  }, 600_000);

  it('1 枚後・2 枚後の全窓探索(相手の番/自分の番)', () => {
    const r = makeRng(43);
    for (const placed of [1, 2]) {
      const ms: number[] = [];
      const nodes: number[] = [];
      for (let i = 0; i < 12; i++) {
        const cards: CardDef[] = Array.from({ length: 10 }, () => ({
          sides: [1 + Math.floor(r() * 10), 1 + Math.floor(r() * 10), 1 + Math.floor(r() * 10), 1 + Math.floor(r() * 10)],
          type: 0,
        }));
        const b = new FastBoard({
          cards, myHand: [0, 1, 2, 3, 4], oppKnown: [5, 6, 7, 8, 9], oppPool: [], poolQuota: 0,
          board: Array(9).fill(null), turn: 0, first: 0,
          ruleBits: toRuleBits({ ...NO_RULES, same: true, plus: true }, { fallenAceInCombo: true }),
          sign: 0, orderMe: false, orderOpp: false,
        });
        for (let k = 0; k < placed; k++) {
          const moves = legalMoves(b);
          const m = moves[Math.floor(r() * moves.length)];
          b.place(m.card, m.cell);
        }
        const t = timed(() => negamax(b, -99, 99));
        ms.push(t.ms);
        nodes.push(t.nodes);
      }
      console.log(`${placed} 枚後: 中央値 ${median(ms).toFixed(1)}ms / ${median(nodes)} nodes、最大 ${Math.max(...ms).toFixed(1)}ms`);
    }
  }, 600_000);
});
