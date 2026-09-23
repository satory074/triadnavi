import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT, INITIAL_STATE, applyNpc, applyOpenRuleset, applyTournament, changeRules, clearNpc, clearOppSlot, draftToSetup, handPriorOf, matchupFromDraft, parseAppState, restartMatch,
  revealPoolCard, setEvents, setMode, setupWarnings, toTop, toggleRule, type AppState,
} from './appState';
import { replay } from './match';
import { RULE_HELP, RULE_NAMES } from './rules';
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

describe('ルールの説明', () => {
  it('名前のある全てのルールに説明がある(空の吹き出しを出さない)', () => {
    for (const id of Object.keys(RULE_NAMES)) expect(RULE_HELP[Number(id)]?.length ?? 0).toBeGreaterThan(0);
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

  it('大会モードでは NPC を選んでも外しても、ルールは大会のまま', () => {
    const t = applyTournament(EMPTY_DRAFT, { id: 3, rules: [8, 4] });
    expect(t).toMatchObject({ mode: 'tournament', tournamentId: 3, ruleIds: [8, 4] });
    const d = applyNpc(t, npc, []);
    expect(d.ruleIds).toEqual([8, 4]);
    expect(d.oppCards).toEqual([c(1), c(2), c(3), null, null]);
    expect(clearNpc(d).ruleIds).toEqual([8, 4]);
    expect(clearNpc(d).npcId).toBeNull();
    // ルーレットが 2 つの大会はチップに出るルールが無い(対戦が始まってから入れる)。評価ではルーレット 2 つとして数える
    const r = applyTournament(EMPTY_DRAFT, { id: 4, rules: [1, 1] });
    expect(r.ruleIds).toEqual([]);
    expect(matchupFromDraft(r, [1, 1])).toMatchObject({ roulette: 2, swap: false, oppPrior: { kind: 'meta' } });
  });

  it('対戦の種類ごとの相手の想定: 大会のプレイヤーは強いデッキ、大会の NPC と通常は 3 段階、ドラフトはドラフトの手札', () => {
    const t = applyTournament(EMPTY_DRAFT, { id: 1, rules: [2, 6] });
    expect(handPriorOf(t)).toEqual({ kind: 'meta' });
    expect(handPriorOf(applyNpc(t, npc, []))).toEqual({ kind: 'level', level: 2 });
    expect(handPriorOf({ ...EMPTY_DRAFT, priorLevel: 3 })).toEqual({ kind: 'level', level: 3 });
    const o = applyOpenRuleset(applyNpc(t, npc, []), { id: 10, rules: [15, 6, 14] });
    expect(o).toMatchObject({ mode: 'open', openRulesetId: 10, tournamentId: null, npcId: null, ruleIds: [6], oppPool: [] });
    expect(handPriorOf(o)).toEqual({ kind: 'draft' });
    expect(matchupFromDraft(o, [15, 6, 14])).toMatchObject({ swap: true, roulette: 0, oppPrior: { kind: 'draft' } });
    // 通常に戻すと大会の選択は忘れるが、ルールは残す
    expect(setMode(t, 'free')).toMatchObject({ mode: 'free', tournamentId: null, ruleIds: [2, 6] });
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
    const draft = { ...EMPTY_DRAFT, mode: 'tournament' as const, tournamentId: 3, myCards: [c(1), c(2), c(3), c(4), c(5)], oppCards: [c(6), c(7), null, null, null], oppPool: [c(8), c(9), c(10)], ruleIds: [4, 6] };
    const setup = draftToSetup(draft)!;
    const state: AppState = { phase: 'play', draft, setup, events: [{ t: 'place', by: 0, card: { from: 'my', index: 0 }, cell: 4 }], historyId: 'h1' };
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
    const partial = parseAppState(JSON.stringify({ phase: 'play', draft: { myCards: [c(1)], mode: 'nope', tournamentId: 'x' }, setup: { myHand: [] } }));
    expect(partial.phase).toBe('setup');
    expect(partial.draft.myCards[0]).toEqual(c(1));
    expect(partial.draft.myCards[1]).toBeNull();
    // 大会の項目が無い/壊れている古い保存は通常モードとして読む
    expect(partial.draft).toMatchObject({ mode: 'free', tournamentId: null, openRulesetId: null });
  });
});

describe('トップは対局画面', () => {
  it('対局中の記録は 1 件も消さず、手札が揃っていなければ設定画面のまま', () => {
    const draft = { ...EMPTY_DRAFT, myCards: [c(1), c(2), c(3), c(4), c(5)] };
    const playing: AppState = { phase: 'play', draft, setup: draftToSetup(draft), events: [{ t: 'place', by: 0, card: { from: 'my', index: 0 }, cell: 4 }], historyId: null };
    expect(toTop(playing)).toBe(playing);
    const fresh = toTop({ ...INITIAL_STATE, draft });
    expect(fresh.phase).toBe('play');
    expect(fresh.setup!.myHand).toEqual(draft.myCards);
    expect(fresh.events).toEqual([]);
    expect(toTop(INITIAL_STATE).phase).toBe('setup');
  });
});

describe('はじめから', () => {
  it('サドンデスの再戦中でも、下書きの手札で最初の対局に戻る', () => {
    const draft = { ...EMPTY_DRAFT, myCards: [c(1), c(2), c(3), c(4), c(5)], ruleIds: [5], first: 1 as const };
    const setup = { ...draftToSetup(draft)!, myHand: [c(9), c(9), c(9), c(9), c(9)], round: 2, first: 0 as const };
    const next = restartMatch({ phase: 'play', draft, setup, events: [{ t: 'place', by: 0, card: { from: 'my', index: 0 }, cell: 4 }], historyId: null });
    expect(next.events).toEqual([]);
    expect(next.setup!.round).toBe(0);
    expect(next.setup!.myHand).toEqual(draft.myCards);
    expect(next.setup!.first).toBe(1);
  });

  it('対戦記録の id は最初のイベントで付き、途中の「はじめから」では同じ、終局後は外れ、通常モードでは付かない', () => {
    const draft = { ...EMPTY_DRAFT, mode: 'tournament' as const, tournamentId: 1, myCards: [c(1), c(2), c(3), c(4), c(5)], oppCards: [c(6), c(7), c(8), c(9), c(10)] };
    const base: AppState = { phase: 'play', draft, setup: draftToSetup(draft)!, events: [], historyId: null };
    // 自分と相手が交互に 0〜8 のマスへ置く(先攻は自分)
    const move = (i: number): AppState['events'][number] => ({ t: 'place', by: i % 2 === 0 ? 0 : 1, card: { from: i % 2 === 0 ? 'my' : 'opp', index: Math.floor(i / 2) }, cell: i });
    const started = setEvents(base, [move(0)], 'h1');
    expect(started.historyId).toBe('h1');
    expect(setEvents(started, [move(0), move(1)], 'h2').historyId).toBe('h1'); // 2 手目では付け直さない
    expect(restartMatch(started).historyId).toBe('h1'); // 途中の「はじめから」は同じ対戦
    const done = setEvents(started, Array.from({ length: 9 }, (_, i) => move(i)), 'h3');
    expect(replay(done.setup!, done.events).finished).toBe(true);
    expect(restartMatch(done).historyId).toBeNull(); // 終局後の「同じ相手ともう一戦」は別の対戦
    expect(setEvents({ ...base, draft: { ...draft, mode: 'free' } }, [move(0)], 'h4').historyId).toBeNull();
  });
});

describe('対局中のルール変更', () => {
  it('記録は 1 件も消えず、「はじめから」でも再読み込みでも新しいルールのまま', () => {
    const draft = { ...EMPTY_DRAFT, myCards: [c(1), c(2), c(3), c(4), c(5)], oppCards: [c(6), c(7), c(8), c(9), c(10)], ruleIds: [2] };
    const events: AppState['events'] = [
      { t: 'place', by: 0, card: { from: 'my', index: 0 }, cell: 4 },
      { t: 'place', by: 1, card: { from: 'opp', index: 0 }, cell: 1 },
    ];
    const next = changeRules({ phase: 'play', draft, setup: draftToSetup(draft)!, events, historyId: null }, [2, 4, 11], false);
    expect(next.events).toEqual(events);
    expect(replay(next.setup!, next.events).applied).toBe(events.length);

    const restarted = restartMatch(next);
    expect(restarted.setup!.rules.same).toBe(true);
    expect(restarted.setup!.options.fallenAceInCombo).toBe(false);

    const reloaded = parseAppState(JSON.stringify(next));
    expect(reloaded.setup!.rules).toEqual(next.setup!.rules);
    expect(reloaded.setup!.options.fallenAceInCombo).toBe(false);
  });
});
