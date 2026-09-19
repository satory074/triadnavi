import { describe, expect, it } from 'vitest';
import {
  canReplace, deckProblems, exportCollection, importCollection, isLegalDeck, parseCollection, withOwned,
} from './collection';
import { makeRng } from './rng';

const rated = (stars: number[]) => stars.map((s, i) => ({ id: i + 1, stars: s }));

describe('デッキの制限', () => {
  it('★5 は 1 枚まで、★4 以上は合わせて 2 枚まで(全ての★の組み合わせを、合法な構成の一覧と照合)', () => {
    // 合法なのは、★4 以上の部分が {}, {4}, {5}, {4,4}, {5,4} のどれかの時だけ
    const legalHigh = new Set(['', '4', '5', '44', '45']);
    for (let n = 0; n < 5 ** 5; n++) {
      const stars = [0, 1, 2, 3, 4].map((k) => 1 + (Math.floor(n / 5 ** k) % 5));
      const high = stars.filter((s) => s >= 4).sort().join('');
      expect(isLegalDeck(rated(stars)), stars.join()).toBe(legalHigh.has(high));
    }
  });

  it('同じカードは 2 枚入れられない', () => {
    const deck = rated([1, 2, 3, 3, 4]);
    expect(isLegalDeck(deck)).toBe(true);
    expect(deckProblems([...deck.slice(0, 4), deck[0]])).toEqual(['duplicate']);
  });

  it('5 枚でなければ不合法', () => {
    expect(deckProblems(rated([1, 1, 1, 1]))).toEqual(['size']);
    expect(deckProblems(rated([1, 1, 1, 1, 1, 1]))).toEqual(['size']);
  });

  it('問題は重ねて報告される', () => {
    expect(deckProblems(rated([5, 5, 5, 1, 1]))).toEqual(['fiveStar', 'fourPlus']);
  });

  it('入れ替えの可否は、入れ替えた後のデッキで判定する', () => {
    const deck = rated([5, 4, 3, 3, 3]);
    expect(canReplace(deck, 2, { id: 99, stars: 4 })).toBe(false);
    expect(canReplace(deck, 1, { id: 99, stars: 4 })).toBe(true);
    expect(canReplace(deck, 1, { id: 99, stars: 5 })).toBe(false);
    expect(canReplace(deck, 0, { id: 99, stars: 5 })).toBe(true);
    // 既にデッキにあるカードは、同じスロットにしか入らない
    expect(canReplace(deck, 3, deck[4])).toBe(false);
    expect(canReplace(deck, 4, deck[4])).toBe(true);
  });
});

describe('手持ちの保存データ', () => {
  it('壊れた保存データでも落ちず、昇順・重複なしの ID だけが残る', () => {
    const r = makeRng(7);
    const junk: unknown[] = [null, undefined, 'x', -1, 0, 1.5, 1e9, NaN, {}, [], true, '12'];
    for (let i = 0; i < 300; i++) {
      const owned = Array.from({ length: Math.floor(r() * 12) }, () =>
        r() < 0.5 ? junk[Math.floor(r() * junk.length)] : 1 + Math.floor(r() * 500),
      );
      const c = parseCollection(JSON.stringify({ owned }));
      expect(c.owned.every((id) => Number.isInteger(id) && id >= 1)).toBe(true);
      expect(c.owned).toEqual([...new Set(c.owned)].sort((a, b) => a - b));
    }
    for (const raw of [null, '', '{', 'null', '[]', '{"owned":3}', '"abc"', '{"owned":{"0":1}}']) {
      expect(parseCollection(raw).owned).toEqual([]);
    }
  });

  it('同梱データに無い ID も保持する', () => {
    expect(parseCollection('{"owned":[3,9000,3,1]}').owned).toEqual([1, 3, 9000]);
  });

  it('所持の付け外しは、元の手持ちを書き換えない', () => {
    const a = { owned: [2, 5] };
    const b = withOwned(a, [9, 1, 5], true);
    expect(b.owned).toEqual([1, 2, 5, 9]);
    expect(withOwned(b, [2, 7], false).owned).toEqual([1, 5, 9]);
    expect(a.owned).toEqual([2, 5]);
  });
});

describe('テキストの書き出しと読み込み', () => {
  it('連続する ID は範囲にまとめる', () => {
    expect(exportCollection({ owned: [1, 2, 3, 7, 9, 10] })).toBe('triadnavi-cards:v1:1-3,7,9-10');
    expect(exportCollection({ owned: [] })).toBe('triadnavi-cards:v1:');
  });

  it('書き出した文字列を読み戻すと同じ集合になる', () => {
    const r = makeRng(11);
    for (let i = 0; i < 200; i++) {
      const owned = [...new Set(Array.from({ length: Math.floor(r() * 60) }, () => 1 + Math.floor(r() * 480)))].sort((a, b) => a - b);
      expect(importCollection(exportCollection({ owned }))).toEqual(owned);
    }
  });

  it('空白・全角・読点・範囲が混ざった入力も読める', () => {
    expect(importCollection(' 3、1 ， 5-7\n１０〜１２ ; 3 ')).toEqual([1, 3, 5, 6, 7, 10, 11, 12]);
    expect(importCollection('TRIADNAVI-CARDS:V1: 4, 2')).toEqual([2, 4]);
  });

  it('読めない部分があれば、半端に取り込まず null を返す', () => {
    for (const bad of ['', '   ', 'abc', '1,x', '5-3', '0', '1-', '-4', '1-2-3', '12345', '1.5']) {
      expect(importCollection(bad), bad).toBeNull();
    }
  });
});
