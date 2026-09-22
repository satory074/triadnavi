import { describe, expect, it } from 'vitest';
import type { GuaranteeKind } from './position';
import { outcomeText } from './rank';
import type { Analysis, MoveEval } from './scheduler';

describe('outcomeText', () => {
  it('どの種別 × どの分類でも空の文にならない(画面の結論の行が消えない)', () => {
    const kinds: GuaranteeKind[] = ['exact', 'pool', 'estimate', 'chaos'];
    const classes: MoveEval['cls'][] = ['win', 'draw', 'notWin', 'loss', undefined];
    for (const kind of kinds) {
      for (const cls of classes) {
        const a = { kind, moves: [], tasks: {}, worldsEnumerated: true } as unknown as Analysis;
        const m = { move: { card: 0, cell: 0 }, cls, staticScore: 0 } as unknown as MoveEval;
        expect(outcomeText(m, a).length).toBeGreaterThan(0);
      }
    }
  });
});
