import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT, INITIAL_STATE, applyNpc, clearOppSlot, draftToSetup, parseAppState, revealPoolCard, setupWarnings, toggleRule,
  type AppState,
} from './appState';
import { replay } from './match';
import type { CardDef } from './types';

const c = (n: number): CardDef => ({ sides: [n, n, n, n], type: 0 });

describe('ルールの切り替え', () => {
  it('公式に排他の 3 組は、片方を選ぶともう片方が外れる', () => {
    expect(toggleRule([2], 3)).toEqual([3]);
    expect(toggleRule([8, 4], 9)).toEqual([4, 9]);
    expect(toggleRule([12], 13)).toEqual([13]);
    expect(toggleRule([4], 6)).toEqual([4, 6]);
    expect(toggleRule([4, 6], 4)).toEqual([6]);
  });
});

describe('NPC の適用', () => {
  const npc = { id: 7, fixed: [c(1), c(2), c(3)], variable: [c(4), c(5), c(6)], rules: [2, 4, 1, 1] };

  it('固定カードは既知、残りは不明スロット + 可変プール。事前に解決されるルールはチップにしない', () => {
    const d = applyNpc(EMPTY_DRAFT, npc, [c(9), c(4)]);
    expect(d.oppCards).toEqual([c(1), c(2), c(3), null, null]);
    expect(d.oppPool).toEqual([c(4), c(5), c(6), c(9)]); // 学習済みの 9 は追加、既にある 4 は重複させない
    expect(d.ruleIds).toEqual([2, 4]);
  });

  it('見えている候補を手札へ移し、外すと候補へ戻る', () => {
    const d = revealPoolCard(applyNpc(EMPTY_DRAFT, npc, []), 1);
    expect(d.oppCards).toEqual([c(1), c(2), c(3), c(5), null]);
    expect(d.oppPool).toEqual([c(4), c(6)]);
    const back = clearOppSlot(d, 3, true);
    expect(back.oppCards[3]).toBeNull();
    expect(back.oppPool).toEqual([c(4), c(6), c(5)]);
  });
});

describe('対戦の開始', () => {
  const full = { ...EMPTY_DRAFT, myCards: [c(1), c(2), c(3), c(4), c(5)] };

  it('自分の手札が揃うまで始められない', () => {
    expect(draftToSetup(EMPTY_DRAFT)).toBeNull();
    expect(draftToSetup(full)).not.toBeNull();
  });

  it('相手の分かっているカードを前に詰める', () => {
    const s = draftToSetup({ ...full, oppCards: [null, c(7), null, c(8), null] })!;
    expect(s.oppSlots).toEqual([c(7), c(8), null, null, null]);
  });

  it('結果の質が落ちる設定には注意を出す', () => {
    expect(setupWarnings({ ...full, ruleIds: [2] }).length).toBe(2); // オールオープンなのに不明あり + 候補不足
    expect(setupWarnings({ ...full, oppCards: [c(1), c(2), c(3), c(4), c(5)] })).toEqual([]);
  });
});

describe('保存と復元', () => {
  it('対局中の状態を往復できる', () => {
    const draft = { ...EMPTY_DRAFT, myCards: [c(1), c(2), c(3), c(4), c(5)], oppCards: [c(6), c(7), null, null, null], oppPool: [c(8), c(9), c(10)], ruleIds: [4, 6] };
    const setup = draftToSetup(draft)!;
    const state: AppState = { phase: 'play', draft, setup, events: [{ t: 'place', by: 0, card: { from: 'my', index: 0 }, cell: 4 }] };
    const back = parseAppState(JSON.stringify(state));
    expect(back).toEqual(state);
    expect(replay(back.setup!, back.events).applied).toBe(1);
  });

  it('サドンデス再戦中の setup(下書きと手札が違う)もそのまま復元する', () => {
    const draft = { ...EMPTY_DRAFT, myCards: [c(1), c(2), c(3), c(4), c(5)], ruleIds: [5] };
    const setup = { ...draftToSetup(draft)!, myHand: [c(9), c(9), c(9), c(9), c(9)], round: 2, first: 1 as const };
    const back = parseAppState(JSON.stringify({ phase: 'play', draft, setup, events: [] }));
    expect(back.setup!.round).toBe(2);
    expect(back.setup!.myHand[0]).toEqual(c(9));
    expect(back.setup!.first).toBe(1);
  });

  it('壊れたデータは初期状態に戻す(下書きが読めればそれは残す)', () => {
    expect(parseAppState(null)).toEqual(INITIAL_STATE);
    expect(parseAppState('not json')).toEqual(INITIAL_STATE);
    const partial = parseAppState(JSON.stringify({ phase: 'play', draft: { myCards: [c(1)] }, setup: { myHand: [] } }));
    expect(partial.phase).toBe('setup');
    expect(partial.draft.myCards[0]).toEqual(c(1));
    expect(partial.draft.myCards[1]).toBeNull();
  });
});
