import { describe, expect, it } from 'vitest';
import { makeRng } from '../core/rng';
import { CARDS, NPCS, findBySides, normalize, npcCards, samplePriorCard, searchCards, searchNpcs, typeFromSides } from './index';

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
