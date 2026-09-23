import { describe, expect, it } from 'vitest';
import { moveItem } from './reorder';

describe('並べ替え', () => {
  it('要素 1 つを動かす。枚数と中身は必ず保たれ、動かない指定では並びも変わらない', () => {
    const a = ['a', 'b', 'c', 'd', 'e'];
    expect(moveItem(a, 2, 0)).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(moveItem(a, 0, 4)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(moveItem(a, 1, 2)).toEqual(['a', 'c', 'b', 'd', 'e']);
    // 動かない指定と範囲外は並びを変えない(呼び出し側が保存する値が壊れないこと)
    expect(moveItem(a, 1, 1)).toEqual(a);
    expect(moveItem(a, 0, 9)).toEqual(a);
    expect(moveItem(a, -1, 2)).toEqual(a);
    // 元の配列は書き換えない
    expect(a).toEqual(['a', 'b', 'c', 'd', 'e']);
    // 枚数と中身は必ず保たれる
    for (let from = 0; from < a.length; from++) {
      for (let to = 0; to < a.length; to++) {
        expect([...moveItem(a, from, to)].sort()).toEqual([...a].sort());
      }
    }
  });
});
