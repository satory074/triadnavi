import { describe, expect, it } from 'vitest';
import { makeRng } from '../core/rng';
import {
  CARDS, CARDS_IN_LIST_ORDER, NPCS, artIdOf, cardArtUrl, cardNumber, findBySides, handProblems, normalize, npcCards, resolveCardIds, resolveDeck,
  samplePriorCard, searchCards, searchNpcs, toCardDef, typeFromSides,
} from './index';

describe('同梱データの整合性', () => {
  it('カードの値が範囲内で、ID が一意', () => {
    expect(CARDS.length).toBeGreaterThanOrEqual(475);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    for (const c of CARDS) {
      expect(c.sides.length).toBe(4);
      expect(c.sides.every((v) => Number.isInteger(v) && v >= 1 && v <= 10)).toBe(true);
      expect(c.type).toBeGreaterThanOrEqual(0);
      expect(c.type).toBeLessThanOrEqual(4);
      expect(c.stars).toBeGreaterThanOrEqual(1);
      expect(c.stars).toBeLessThanOrEqual(5);
    }
  });

  it('カードリストの番号は No. と Ex. のそれぞれで 1 から連番になっている', () => {
    for (const ex of [false, true]) {
      const orders = CARDS.filter((c) => c.ex === ex).map((c) => c.order).sort((a, b) => a - b);
      expect(orders).toEqual(orders.map((_, i) => i + 1));
    }
    expect(CARDS_IN_LIST_ORDER.length).toBe(CARDS.length);
    expect(cardNumber(CARDS_IN_LIST_ORDER[0])).toBe('No. 1');
    expect(cardNumber(CARDS_IN_LIST_ORDER[CARDS.length - 1])).toMatch(/^Ex\. \d+$/);
  });

  it('NPC のデッキに参照切れが無く、手札 5 枚を組める', () => {
    expect(NPCS.length).toBeGreaterThanOrEqual(134);
    for (const n of NPCS) {
      const { fixed, variable } = npcCards(n);
      expect(fixed.length).toBe(n.fixed.length);
      expect(variable.length).toBe(n.variable.length);
      expect(fixed.length).toBeGreaterThanOrEqual(1);
      expect(fixed.length).toBeLessThanOrEqual(5);
      // 固定カードは必ず入り、残りの枠は可変プールから埋まる
      expect(variable.length).toBeGreaterThanOrEqual(5 - fixed.length);
      expect(n.rules.every((r) => r >= 1 && r <= 15)).toBe(true);
    }
  });

  it('既知のカードの向きが合っている(スコール: 上 6 / 右 A / 下 A / 左 1)', () => {
    const squall = CARDS.find((c) => c.name === 'スコール・レオンハート')!;
    expect(squall.sides).toEqual([6, 10, 10, 1]);
    expect(squall.stars).toBe(5);
  });
});

describe('カード ID への対応づけ', () => {
  it('どのカードも、自分自身の ID が先頭に来る', () => {
    for (const c of CARDS) expect(resolveCardIds(toCardDef(c))[0]).toBe(c.id);
  });

  it('数字もタイプも同じ別カードは、名前が無ければ両方が候補になる', () => {
    const ids = resolveCardIds({ sides: [7, 7, 7, 7], type: 0 });
    expect(ids.length).toBe(2);
    expect(resolveCardIds({ sides: [7, 7, 7, 7], type: 0, label: 'ゼレニア' })[0]).toBe(CARDS.find((c) => c.name === 'ゼレニア')!.id);
  });

  it('手札の対応づけでは同じ ID を 2 回使わず、同梱データに無いカードがあれば null', () => {
    const seven = { sides: [7, 7, 7, 7], type: 0 } as const;
    const others = CARDS.slice(0, 3).map(toCardDef);
    const deck = resolveDeck([seven, seven, ...others]);
    expect(deck).not.toBeNull();
    expect(new Set(deck!.map((c) => c.id)).size).toBe(5);
    expect(resolveDeck([seven, seven, seven, ...others.slice(0, 2)])).toBeNull();
    expect(resolveDeck([{ sides: [1, 1, 1, 1], type: 0 }, ...CARDS.slice(0, 4).map(toCardDef)])).toBeNull();
  });
});

describe('入力中の手札の制限', () => {
  const pick = (stars: number, n: number) => CARDS.filter((c) => c.stars === stars).slice(0, n).map(toCardDef);

  it('★5 が 2 枚、★4 以上が 3 枚で違反になる。途中までの入力でも分かる', () => {
    expect(handProblems([...pick(5, 1), ...pick(4, 1), ...pick(3, 3)])).toEqual([]);
    expect(handProblems([...pick(5, 2), null, null, null])).toEqual(['fiveStar']);
    expect(handProblems([...pick(4, 3), null, null])).toEqual(['fourPlus']);
    expect(handProblems([null, null, null, null, null])).toEqual([]);
  });

  it('同じカードを 2 枚入れると違反。数字が同じ別カードが 2 種類ある時は 3 枚目から', () => {
    const dodo = toCardDef(CARDS[0]);
    expect(handProblems([dodo, dodo, null, null, null])).toEqual(['duplicate']);
    const seven = { sides: [7, 7, 7, 7], type: 0 } as const;
    expect(handProblems([seven, seven, null, null, null])).toEqual([]);
    expect(handProblems([seven, seven, seven, null, null])).toContain('duplicate');
  });

  it('同梱データに無い手入力のカードは数えない', () => {
    expect(handProblems([{ sides: [1, 1, 1, 1], type: 0 }, { sides: [1, 1, 1, 1], type: 0 }, null, null, null])).toEqual([]);
  });
});

describe('数字からの逆引き', () => {
  it('ほとんどの組は 1 枚に決まる', () => {
    const keys = new Map<string, number>();
    for (const c of CARDS) keys.set(c.sides.join(), (keys.get(c.sides.join()) ?? 0) + 1);
    const unique = [...keys.values()].filter((n) => n === 1).length;
    expect(unique / keys.size).toBeGreaterThan(0.95);
  });

  it('同じ数字でタイプが食い違う組では、タイプを自動判定しない', () => {
    const asura = findBySides([9, 5, 7, 6]);
    expect(asura.map((c) => c.name).sort()).toEqual(['アスラ', 'セニョール・サボテンダー'].sort());
    expect(typeFromSides([9, 5, 7, 6])).toBeUndefined();
  });

  it('一意な組ではタイプが決まり、未収録の組では決まらない', () => {
    expect(typeFromSides([6, 10, 10, 1])).toBe(0);
    const typed = CARDS.find((c) => c.type !== 0 && findBySides(c.sides).length === 1)!;
    expect(typeFromSides(typed.sides)).toBe(typed.type);
    expect(findBySides([1, 1, 1, 1])).toEqual([]);
    expect(typeFromSides([1, 1, 1, 1])).toBeUndefined();
  });
});

describe('検索', () => {
  it('ひらがなでもカタカナのカード名に当たる', () => {
    expect(normalize('いふりーと')).toBe('イフリート');
    expect(searchCards('いふりーと').some((c) => c.name === 'イフリート')).toBe(true);
    expect(searchCards('')).toEqual([]);
  });

  it('NPC は名前でも場所でも探せる', () => {
    expect(searchNpcs('メメルン')[0].name).toBe('メメルン');
    expect(searchNpcs('ゴールドソーサー').length).toBeGreaterThan(3);
  });
});

describe('事前分布', () => {
  it('強さの想定が高いほど、平均の辺の値が大きい', () => {
    const mean = (level: 1 | 2 | 3) => {
      const r = makeRng(level);
      let sum = 0;
      for (let i = 0; i < 2000; i++) sum += samplePriorCard(r, level).sides.reduce((a, b) => a + b, 0);
      return sum / 2000;
    };
    expect(mean(1)).toBeLessThan(mean(2));
    expect(mean(2)).toBeLessThan(mean(3));
  });
});

describe('カードの絵', () => {
  // 数字が同じカードの組。同梱データから数える(カードが増えても追従する)
  const groups = [...new Set(CARDS.map((c) => c.sides.join(',')))]
    .map((k) => CARDS.filter((c) => c.sides.join(',') === k))
    .filter((g) => g.length > 1);

  it('どのカードも、自分の絵に決まる', () => {
    for (const c of CARDS) expect(artIdOf(toCardDef(c))).toBe(c.id);
  });

  it('数字が同じカードは、名前が一致した時だけ絵を出す', () => {
    expect(groups.length).toBeGreaterThanOrEqual(9);
    for (const g of groups) {
      const { sides, type } = g[0];
      // 数字を打って確定した時の形(CardEditor は名前を連結する)
      expect(artIdOf({ sides, type, label: g.map((c) => c.name).join(' / ') })).toBeUndefined();
      expect(artIdOf({ sides, type })).toBeUndefined();
      for (const c of g) expect(artIdOf(toCardDef(c))).toBe(c.id);
    }
  });

  it('タイプだけが違う組でも、タイプで 1 枚に絞らない', () => {
    // タイプが結果に効かない時、CardEditor は先頭の候補のタイプで確定する。タイプで絞ると先頭のカードの絵に決まってしまう
    const hits = findBySides([9, 5, 7, 6]);
    expect(hits.length).toBe(2);
    expect(new Set(hits.map((c) => c.type)).size).toBe(2);
    for (const c of hits) expect(artIdOf({ sides: c.sides, type: c.type })).toBeUndefined();
  });

  it('同梱データに無い数字には絵が無い', () => {
    expect(findBySides([1, 1, 1, 1])).toEqual([]);
    expect(artIdOf({ sides: [1, 1, 1, 1], type: 0 })).toBeUndefined();
  });

  it('アイコン番号は 87000 + ID を 6 桁にそろえる', () => {
    expect(cardArtUrl(1)).toBe('https://v2.xivapi.com/api/asset?path=ui/icon/087000/087001.tex&format=webp');
    expect(cardArtUrl(475)).toContain('/087000/087475.tex');
    expect(cardArtUrl(1, true)).toContain('/087000/087001_hr1.tex');
  });
});
