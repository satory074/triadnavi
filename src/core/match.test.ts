import { describe, expect, it } from 'vitest';
import { cardRefOf, needsForcedCard, orderForcedCard, replay, toPosition, type MatchEvent, type MatchSetup } from './match';
import { guaranteeKind } from './position';
import { learnCards, parseSaved, EMPTY_SAVED } from './presets';
import { buildRematch, MAX_REMATCHES } from './suddenDeath';
import { DEFAULT_OPTIONS, NO_RULES, type CardDef, type CardType } from './types';

const c = (t: number, r: number, b: number, l: number, type: CardType = 0): CardDef => ({ sides: [t, r, b, l], type });

const baseSetup = (over: Partial<MatchSetup> = {}): MatchSetup => ({
  rules: { ...NO_RULES, same: true, plus: true, open: 'all' },
  options: DEFAULT_OPTIONS,
  myHand: [c(1, 1, 1, 1), c(5, 1, 1, 1), c(4, 1, 1, 9), c(2, 2, 2, 2), c(3, 3, 3, 3)],
  oppSlots: [c(1, 2, 1, 1), c(3, 3, 4, 5), c(2, 9, 2, 2), c(6, 6, 6, 6), c(7, 7, 7, 7)],
  oppPool: [],
  first: 1,
  round: 0,
  oppOrderKnown: false,
  ...over,
});

// 計画書の手動テスト対局(セイム+プラス、相手が先攻)
const script: MatchEvent[] = [
  { t: 'place', by: 1, card: { from: 'opp', index: 0 }, cell: 0 },
  { t: 'place', by: 0, card: { from: 'my', index: 0 }, cell: 8 },
  { t: 'place', by: 1, card: { from: 'opp', index: 1 }, cell: 1 },
  { t: 'place', by: 0, card: { from: 'my', index: 1 }, cell: 6 },
  { t: 'place', by: 1, card: { from: 'opp', index: 2 }, cell: 3 },
  { t: 'place', by: 0, card: { from: 'my', index: 2 }, cell: 4 },
];

describe('対局の再生', () => {
  it('手動テスト対局: 6 手目でセイム → コンボが起き、盤面の 6 枚が全て青になる', () => {
    const v = replay(baseSetup(), script);
    expect(v.applied).toBe(6);
    expect(v.lastFlips.map((f) => [f.cell, f.cause]).sort()).toEqual([[0, 'combo'], [1, 'same'], [3, 'same']]);
    expect(v.state.board.filter((x) => x?.owner === 0).length).toBe(6);
    expect(v.turn).toBe(1);
    expect(v.myHand.length).toBe(2);
    expect(v.oppKnown.length).toBe(2);
    expect(v.finished).toBe(false);
  });

  it('取り消し = 末尾のイベントを捨てる', () => {
    const v = replay(baseSetup(), script.slice(0, 5));
    expect(v.state.board.filter((x) => x?.owner === 1).length).toBe(3);
    expect(v.turn).toBe(0);
  });

  it('手番違い・埋まったマス・使用済みカードなどの壊れたイベント以降は捨てる', () => {
    const bad: MatchEvent[] = [...script.slice(0, 2), { t: 'place', by: 0, card: { from: 'my', index: 1 }, cell: 5 }];
    expect(replay(baseSetup(), bad).applied).toBe(2);
    const occupied: MatchEvent[] = [...script.slice(0, 2), { t: 'place', by: 1, card: { from: 'opp', index: 1 }, cell: 8 }];
    expect(replay(baseSetup(), occupied).applied).toBe(2);
    const reused: MatchEvent[] = [...script.slice(0, 2), { t: 'place', by: 1, card: { from: 'opp', index: 0 }, cell: 5 }];
    expect(replay(baseSetup(), reused).applied).toBe(2);
  });

  it('所有の手動修正を記録し、以降は「参考」扱いになる', () => {
    const v = replay(baseSetup(), [...script, { t: 'setOwner', cell: 0, owner: 1 }]);
    expect(v.state.board[0]!.owner).toBe(1);
    expect(v.overridden).toBe(true);
    // 同じ所有への修正は食い違いではない
    expect(replay(baseSetup(), [...script, { t: 'setOwner', cell: 0, owner: 0 }]).overridden).toBe(false);
  });

  it('終局したら 10 枚で採点する', () => {
    const rest: MatchEvent[] = [
      { t: 'place', by: 1, card: { from: 'opp', index: 3 }, cell: 2 },
      { t: 'place', by: 0, card: { from: 'my', index: 3 }, cell: 5 },
      { t: 'place', by: 1, card: { from: 'opp', index: 4 }, cell: 7 },
    ];
    const v = replay(baseSetup(), [...script, ...rest]);
    expect(v.finished).toBe(true);
    expect(v.score!.me + v.score!.opp).toBe(10);
    expect(v.myHand.length).toBe(1); // 後攻の自分の手元に 1 枚残る
  });
});

describe('非公開手札', () => {
  const hidden = () =>
    baseSetup({
      oppSlots: [c(1, 2, 1, 1), c(3, 3, 4, 5), null, null, null],
      oppPool: [c(2, 9, 2, 2), c(6, 6, 6, 6), c(7, 7, 7, 7), c(8, 8, 8, 8)],
    });

  it('候補リストのカードが出ると、不明スロットと候補が 1 つずつ減る', () => {
    const v = replay(hidden(), [{ t: 'place', by: 1, card: { from: 'pool', index: 0 }, cell: 0 }]);
    expect(v.oppUnknown).toBe(2);
    expect(v.oppPool.length).toBe(3);
    expect(v.outOfPool).toBe(false);
    expect(guaranteeKind(toPosition(hidden(), v))).toBe('pool');
  });

  it('候補リスト外のカードが出たら、保証が無効だったことを記録する', () => {
    const v = replay(hidden(), [{ t: 'place', by: 1, card: { from: 'adhoc', card: c(9, 9, 9, 9) }, cell: 0 }]);
    expect(v.applied).toBe(1);
    expect(v.oppUnknown).toBe(2);
    expect(v.outOfPool).toBe(true);
    expect(v.cards[v.state.board[0]!.card].sides).toEqual([9, 9, 9, 9]);
  });

  it('不明スロットが無くても、入力に無いカードは受け付けて食い違いを記録する(入力ミスで詰まないように)', () => {
    const v = replay(baseSetup(), [{ t: 'place', by: 1, card: { from: 'adhoc', card: c(9, 9, 9, 9) }, cell: 0 }]);
    expect(v.applied).toBe(1);
    expect(v.outOfPool).toBe(true);
    expect(v.oppUnknown).toBe(0);
    expect(v.oppKnown.length).toBe(5);
  });

  it('不明スロットが無ければ、候補のカードは出せない', () => {
    const s = baseSetup({ oppPool: [c(8, 8, 8, 8)] });
    expect(replay(s, [{ t: 'place', by: 1, card: { from: 'pool', index: 0 }, cell: 0 }]).applied).toBe(0);
  });

  it('見えている相手のカードを、出される前に開ける(オールオープン等)', () => {
    const s = hidden();
    const v = replay(s, [{ t: 'reveal', card: { from: 'pool', index: 0 } }]);
    expect(v.applied).toBe(1);
    expect(v.oppUnknown).toBe(2);
    expect(v.oppPool.length).toBe(3);
    expect(v.oppKnown.length).toBe(3);
    expect(v.outOfPool).toBe(false);
    // 3 枚とも開けば「確定」で読める
    const evs: MatchEvent[] = [0, 1, 2].map((index) => ({ t: 'reveal', card: { from: 'pool', index } }));
    const all = replay(s, evs);
    expect(all.oppUnknown).toBe(0);
    expect(guaranteeKind(toPosition(s, all))).toBe('exact');
  });

  it('開いたカードは、そのまま相手の手として出せる', () => {
    const s = hidden();
    const v = replay(s, [
      { t: 'reveal', card: { from: 'pool', index: 0 } },
      { t: 'place', by: 1, card: { from: 'revealed', index: 0 }, cell: 0 },
    ]);
    expect(v.applied).toBe(2);
    expect(v.cards[v.state.board[0]!.card]).toEqual(s.oppPool[0]);
    expect(v.oppKnown.length).toBe(2);
    expect(v.oppUnknown).toBe(2);
    expect(v.turn).toBe(0);
  });

  it('候補リストに無いカードが見えたら、保証が無効だったことを記録する', () => {
    const v = replay(hidden(), [{ t: 'reveal', card: { from: 'adhoc', card: c(9, 9, 9, 9) } }]);
    expect(v.applied).toBe(1);
    expect(v.oppUnknown).toBe(2);
    expect(v.outOfPool).toBe(true);
    expect(v.cards[v.revealed[0]].sides).toEqual([9, 9, 9, 9]);
  });

  it('不明スロットが無い、または同じ候補を 2 回開くイベントは捨てる', () => {
    expect(replay(baseSetup({ oppPool: [c(8, 8, 8, 8)] }), [{ t: 'reveal', card: { from: 'pool', index: 0 } }]).applied).toBe(0);
    const twice: MatchEvent[] = [{ t: 'reveal', card: { from: 'pool', index: 0 } }, { t: 'reveal', card: { from: 'pool', index: 0 } }];
    expect(replay(hidden(), twice).applied).toBe(1);
  });

  it('cards への添字と CardRef を相互に変換できる', () => {
    const s = hidden();
    expect(cardRefOf(s, 0)).toEqual({ from: 'my', index: 0 });
    expect(cardRefOf(s, 5)).toEqual({ from: 'opp', index: 0 });
    expect(cardRefOf(s, 6)).toEqual({ from: 'opp', index: 1 });
    expect(cardRefOf(s, 7)).toEqual({ from: 'pool', index: 0 });
    expect(cardRefOf(s, 10)).toEqual({ from: 'pool', index: 3 });
    expect(cardRefOf(s, 11)).toBeNull();
    // 開いたカードは、候補リストの添字と重なるので revealed が優先される
    const v = replay(s, [{ t: 'reveal', card: { from: 'pool', index: 1 } }]);
    expect(cardRefOf(s, v.revealed[0], v.revealed)).toEqual({ from: 'revealed', index: 0 });
  });
});

describe('スワップ', () => {
  const hidden = () =>
    baseSetup({
      oppSlots: [c(1, 2, 1, 1), c(3, 3, 4, 5), null, null, null],
      oppPool: [c(2, 9, 2, 2), c(6, 6, 6, 6), c(7, 7, 7, 7), c(8, 8, 8, 8)],
    });
  const hand = (v: ReturnType<typeof replay>, which: 'myHand' | 'oppKnown') => v[which].map((i) => v.cards[i]);

  it('相手の分かっているカードと入れ替える(どちらも元の位置に入る)', () => {
    const s = baseSetup();
    const v = replay(s, [{ t: 'swap', mine: 1, theirs: { from: 'opp', index: 2 } }]);
    expect(v.applied).toBe(1);
    expect(hand(v, 'myHand')).toEqual([s.myHand[0], s.oppSlots[2], s.myHand[2], s.myHand[3], s.myHand[4]]);
    expect(hand(v, 'oppKnown')).toEqual([s.oppSlots[0], s.oppSlots[1], s.myHand[1], s.oppSlots[3], s.oppSlots[4]]);
    expect(v.oppUnknown).toBe(0);
  });

  it('交換したカードは、対局中それぞれの持ち主として出せる', () => {
    const s = baseSetup();
    const v = replay(s, [
      { t: 'swap', mine: 1, theirs: { from: 'opp', index: 2 } },
      // revealed = [来たカード, 渡したカード]
      { t: 'place', by: 1, card: { from: 'revealed', index: 1 }, cell: 0 },
      { t: 'place', by: 0, card: { from: 'revealed', index: 0 }, cell: 1 },
    ]);
    expect(v.applied).toBe(3);
    expect(v.cards[v.state.board[0]!.card]).toEqual(s.myHand[1]);
    expect(v.cards[v.state.board[1]!.card]).toEqual(s.oppSlots[2]);
    expect(v.myHand.length).toBe(4);
    expect(v.oppKnown.length).toBe(4);
  });

  it('裏向きのカードと入れ替えると、不明スロットが 1 つ減る', () => {
    const s = hidden();
    const v = replay(s, [{ t: 'swap', mine: 0, theirs: { from: 'pool', index: 1 } }]);
    expect(v.applied).toBe(1);
    expect(hand(v, 'myHand')[0]).toEqual(s.oppPool[1]);
    expect(v.oppUnknown).toBe(2);
    expect(v.oppPool.length).toBe(3);
    expect(hand(v, 'oppKnown')).toContainEqual(s.myHand[0]);
    expect(v.outOfPool).toBe(false);
  });

  it('候補リストに無いカードが来たら、保証が無効だったことを記録する', () => {
    const v = replay(hidden(), [{ t: 'swap', mine: 0, theirs: { from: 'adhoc', card: c(9, 9, 9, 9) } }]);
    expect(v.applied).toBe(1);
    expect(v.oppUnknown).toBe(2);
    expect(v.outOfPool).toBe(true);
    expect(hand(v, 'myHand')[0].sides).toEqual([9, 9, 9, 9]);
  });

  it('開いたカードとも入れ替えられる', () => {
    const s = hidden();
    const v = replay(s, [
      { t: 'reveal', card: { from: 'pool', index: 0 } },
      { t: 'swap', mine: 2, theirs: { from: 'revealed', index: 0 } },
    ]);
    expect(v.applied).toBe(2);
    expect(hand(v, 'myHand')[2]).toEqual(s.oppPool[0]);
    expect(hand(v, 'oppKnown')).toContainEqual(s.myHand[2]);
    expect(v.oppUnknown).toBe(2);
  });

  it('置く前のスワップと開く記録は、先攻に依らず全て再生される(対局画面で先攻を切り替えても消えない)', () => {
    const events: MatchEvent[] = [
      { t: 'reveal', card: { from: 'pool', index: 0 } },
      { t: 'swap', mine: 2, theirs: { from: 'revealed', index: 0 } },
    ];
    for (const first of [0, 1] as const) {
      const v = replay({ ...hidden(), first }, events);
      expect(v.applied).toBe(events.length);
      expect(v.turn).toBe(first);
    }
  });

  it('自分の手札に無いカード、相手が持っていないカード、不明スロットが無い手入力は捨てる', () => {
    const s = baseSetup();
    const twice: MatchEvent[] = [
      { t: 'swap', mine: 1, theirs: { from: 'opp', index: 2 } },
      { t: 'swap', mine: 1, theirs: { from: 'opp', index: 3 } },
    ];
    expect(replay(s, twice).applied).toBe(1);
    expect(replay(s, [{ t: 'swap', mine: 9, theirs: { from: 'opp', index: 0 } }]).applied).toBe(0);
    // 相手の手札が全て分かっているなら、リストに無いカードは来ない(入力ミス)
    expect(replay(s, [{ t: 'swap', mine: 0, theirs: { from: 'adhoc', card: c(9, 9, 9, 9) } }]).applied).toBe(0);
  });

  it('スワップしたら、相手の並び順の前提は使わない', () => {
    const s = baseSetup({ rules: { ...NO_RULES, pick: 'order' }, oppOrderKnown: true });
    expect(toPosition(s, replay(s, [])).oppOrderKnown).toBe(true);
    const v = replay(s, [{ t: 'swap', mine: 0, theirs: { from: 'opp', index: 0 } }]);
    expect(toPosition(s, v).oppOrderKnown).toBe(false);
  });
});

describe('オーダーとカオス', () => {
  it('オーダーでは先頭の未使用カードが強制される', () => {
    const s = baseSetup({ rules: { ...NO_RULES, pick: 'order' }, first: 0 });
    expect(orderForcedCard(s, replay(s, []))).toBe(0);
    const v = replay(s, [{ t: 'place', by: 0, card: { from: 'my', index: 0 }, cell: 0 }, { t: 'place', by: 1, card: { from: 'opp', index: 3 }, cell: 1 }]);
    expect(orderForcedCard(s, v)).toBe(1);
    expect(needsForcedCard(s)).toBe(false);
  });

  it('対局中にカードを開いたら、相手の並び順の前提は使わない', () => {
    const s = baseSetup({
      rules: { ...NO_RULES, pick: 'order' },
      oppSlots: [c(1, 2, 1, 1), c(3, 3, 4, 5), c(2, 9, 2, 2), c(6, 6, 6, 6), null],
      oppPool: [c(7, 7, 7, 7)],
      oppOrderKnown: true,
    });
    expect(toPosition(s, replay(s, [])).oppOrderKnown).toBe(true);
    const v = replay(s, [{ t: 'reveal', card: { from: 'pool', index: 0 } }]);
    expect(v.oppUnknown).toBe(0);
    expect(toPosition(s, v).oppOrderKnown).toBe(false);
  });

  it('カオス、およびサドンデス再戦中のオーダーでは、強制カードをユーザーに教えてもらう', () => {
    expect(needsForcedCard(baseSetup({ rules: { ...NO_RULES, pick: 'chaos' } }))).toBe(true);
    const rematch = baseSetup({ rules: { ...NO_RULES, pick: 'order' }, round: 1, first: 0 });
    expect(needsForcedCard(rematch)).toBe(true);
    expect(orderForcedCard(rematch, replay(rematch, []))).toBeNull();
    const pos = toPosition(rematch, replay(rematch, []), 2);
    expect(pos.rules.pick).toBe('chaos');
    expect(pos.forcedCard).toBe(2);
  });
});

describe('サドンデスの再戦', () => {
  // 何も裏返らない対局 → 5-5 の引き分け
  const weak = c(1, 1, 1, 1);
  const drawSetup = (first: 0 | 1, over: Partial<MatchSetup> = {}): MatchSetup =>
    baseSetup({
      rules: { ...NO_RULES, suddenDeath: true },
      // 目印はラベルで付ける(数字を変えると隣を取ってしまい、引き分けにならない)
      myHand: [weak, weak, weak, weak, { ...weak, label: 'my5' }],
      oppSlots: [weak, weak, weak, weak, { ...weak, label: 'opp5' }],
      first,
      ...over,
    });
  const drawEvents = (first: 0 | 1): MatchEvent[] => {
    const evs: MatchEvent[] = [];
    const n = [0, 0];
    for (let i = 0; i < 9; i++) {
      const by = ((first + i) % 2) as 0 | 1;
      evs.push({ t: 'place', by, card: { from: by === 0 ? 'my' : 'opp', index: n[by]++ }, cell: i });
    }
    return evs;
  };

  it('支配していたカード(盤面 + 後攻の手元の 1 枚)で手札を組み直し、先攻は交互', () => {
    const s = drawSetup(0);
    const v = replay(s, drawEvents(0));
    expect(v.outcome).toBe('draw');
    const next = buildRematch(s, v)!;
    expect(next.round).toBe(1);
    expect(next.first).toBe(1);
    expect(next.myHand.length).toBe(5);
    expect(next.oppSlots.length).toBe(5);
    // 相手は後攻だったので、手元に残った 5 枚目が手札に入る
    expect(next.oppSlots.some((x) => x?.label === 'opp5')).toBe(true);
    // 自分は先攻で 5 枚とも置いた
    expect(next.myHand.some((x) => x.label === 'my5')).toBe(true);
    expect(buildRematch(s, v, 0)!.first).toBe(0);
  });

  it('自分が後攻なら、手元の 1 枚が自分の手札に入る', () => {
    const s = drawSetup(1);
    const next = buildRematch(s, replay(s, drawEvents(1)))!;
    expect(next.myHand.some((x) => x.label === 'my5')).toBe(true);
    expect(next.first).toBe(0);
  });

  it('相手の手元の 1 枚が不明スロットなら、再戦でも不明 1 枠として扱い候補を引き継ぐ', () => {
    const s = drawSetup(0, { oppSlots: [weak, weak, weak, weak, null], oppPool: [c(1, 1, 1, 1), c(1, 1, 1, 3)] });
    const next = buildRematch(s, replay(s, drawEvents(0)))!;
    expect(next.oppSlots.filter((x) => x === null).length).toBe(1);
    expect(next.oppPool.length).toBe(2);
  });

  it('引き分けでない、ルールが無効、再戦回数の上限では組まない', () => {
    const s = drawSetup(0);
    const v = replay(s, drawEvents(0));
    expect(buildRematch({ ...s, rules: NO_RULES }, v)).toBeNull();
    expect(buildRematch({ ...s, round: MAX_REMATCHES }, v)).toBeNull();
    expect(buildRematch(s, replay(s, drawEvents(0).slice(0, 8)))).toBeNull();
  });
});

describe('保存データ', () => {
  it('壊れたデータは空として読む', () => {
    expect(parseSaved(null)).toEqual(EMPTY_SAVED);
    expect(parseSaved('{oops')).toEqual(EMPTY_SAVED);
    expect(parseSaved('{"decks":[{"id":"a","name":"x","cards":[1,2,3]}]}').decks).toEqual([]);
  });

  it('正しいデッキは読み込み、範囲外の値を含むデッキは捨てる', () => {
    const good = { id: 'a', name: 'メイン', cards: Array(5).fill({ sides: [1, 2, 3, 10], type: 2, label: 'x' }) };
    const bad = { id: 'b', name: 'だめ', cards: Array(5).fill({ sides: [1, 2, 3, 11], type: 0 }) };
    const d = parseSaved(JSON.stringify({ decks: [good, bad] }));
    expect(d.decks.map((x) => x.id)).toEqual(['a']);
    expect(d.decks[0].cards[0]).toEqual({ sides: [1, 2, 3, 10], type: 2, label: 'x' });
  });

  it('候補リストに無かったカードだけを学習する(重複なし)', () => {
    const known = [c(1, 1, 1, 1)];
    const d1 = learnCards(EMPTY_SAVED, '42', [c(1, 1, 1, 1), c(9, 9, 9, 9), c(9, 9, 9, 9)], known);
    expect(d1.learned['42']).toEqual([c(9, 9, 9, 9)]);
    expect(learnCards(d1, '42', [c(9, 9, 9, 9)], known)).toBe(d1);
  });
});
