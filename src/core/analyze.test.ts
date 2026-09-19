import { describe, expect, it } from 'vitest';
import { analyzeSync, startAnalysis } from './analyzeSync';
import { createContext, runTask, type Task } from './analyze';
import { guaranteeKind, toFastBoard, type Position } from './position';
import { compareMoves, rankedMoves, recommended } from './rank';
import { emptyState, placeRef, scoreRef, type RefState } from './refEngine';
import { makeRng, type Rng } from './rng';
import { applyResult, markIssued, nextTasks, progress, topClass, type MoveEval } from './scheduler';
import { exactMove } from './search';
import { DEFAULT_OPTIONS, NO_RULES, type CardDef, type Outcome, type Player, type RuleSet } from './types';
import { combinations, makeChaosWorlds, makeWorlds, type WorldOptions } from './worlds';

const cls = (v: number): Outcome => (v > 0 ? 'win' : v === 0 ? 'draw' : 'loss');

function randomCard(r: Rng, alpha: readonly number[]): CardDef {
  const p = () => alpha[Math.floor(r() * alpha.length)];
  return { sides: [p(), p(), p(), p()], type: 0 };
}

/** k 手進んだ、自分の手番の局面を作る(相手の手札は全て既知) */
function randomPosition(r: Rng, rules: Partial<RuleSet>, k: number): Position {
  const alpha = r() < 0.5 ? [1, 2, 3, 9, 10] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const cards = Array.from({ length: 10 }, () => randomCard(r, alpha));
  // k が偶数なら自分が先攻、奇数なら相手が先攻で、k 手後に自分の手番になる
  const first = (k % 2 === 0 ? 0 : 1) as Player;
  const hands = [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]];
  const empty = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const fullRules = { ...NO_RULES, ...rules };
  let state = emptyState(cards, fullRules, DEFAULT_OPTIONS);
  let turn = first;
  for (let i = 0; i < k; i++) {
    const card = hands[turn].splice(Math.floor(r() * hands[turn].length), 1)[0];
    const cell = empty.splice(Math.floor(r() * empty.length), 1)[0];
    state = placeRef(state, turn, card, cell).state;
    turn = (turn ^ 1) as Player;
  }
  return {
    cards,
    board: state.board.map((c) => (c ? { card: c.card, owner: c.owner } : null)),
    myHand: hands[0],
    oppKnown: hands[1],
    oppPool: [],
    oppUnknown: 0,
    turn: 0,
    first,
    rules: fullRules,
    options: DEFAULT_OPTIONS,
    oppOrderKnown: false,
  };
}

const worldOpts = (seed: number): WorldOptions => ({
  rng: makeRng(seed),
  maxEnumerate: 30,
  samples: 6,
  samplePrior: (r) => randomCard(r, [3, 4, 5, 6, 7, 8]),
});

describe('完全情報の解析', () => {
  it('各手の保証クラスが厳密値と一致し、同点の手には副指標が付く', () => {
    const r = makeRng(31);
    for (let i = 0; i < 40; i++) {
      const pos = randomPosition(r, { same: r() < 0.5, plus: r() < 0.5 }, 3 + Math.floor(r() * 4));
      expect(guaranteeKind(pos)).toBe('exact');
      const a = analyzeSync(pos, makeWorlds(pos, worldOpts(i)));
      const map = toFastBoard(pos);
      const values = a.moves.map((m) => exactMove(map.board, { card: map.toFast[m.move.card], cell: m.move.cell }, -99, 99));
      const best = Math.max(...values);
      expect(topClass(a)).toBe(cls(best));

      a.moves.forEach((m, j) => {
        expect(m.cls).toBe(cls(values[j])); // 段階 3 まで終われば notWin は残らない
        const member = cls(values[j]) === cls(best);
        if (member && cls(best) === 'win') expect(m.value).toBe(values[j]);
        if (member && cls(best) !== 'win') expect(m.mistakes).toBeDefined();
        if (!member) expect(m.mistakes).toBeUndefined();
      });

      const rec = recommended(a)!;
      const recValue = values[a.moves.findIndex((m) => m.move === rec.move)];
      expect(cls(recValue)).toBe(cls(best));
      expect(progress(a).complete).toBe(true);
    }
  });

  it('勝ちクラスでは枚数差が大きい手を優先する', () => {
    const base: MoveEval = { move: { card: 0, cell: 0 }, staticScore: 0, cls: 'win' };
    const small = { ...base, value: 1 };
    const big = { ...base, move: { card: 0, cell: 1 }, value: 3 };
    expect(compareMoves(big, small, 'exact')).toBeLessThan(0);
  });

  it('引き分けクラスでは、相手の応手で勝ちが確定する割合が高い手を優先する', () => {
    const base: MoveEval = { move: { card: 0, cell: 0 }, staticScore: 0, cls: 'draw' };
    const a = { ...base, mistakes: { replies: 10, toWin: 2, toDrawOrBetter: 10 } };
    const b = { ...base, move: { card: 0, cell: 1 }, staticScore: 999, mistakes: { replies: 10, toWin: 7, toDrawOrBetter: 10 } };
    expect(compareMoves(b, a, 'exact')).toBeLessThan(0);
    // 保証クラスは副指標より常に優先
    const loss = { ...base, move: { card: 0, cell: 2 }, cls: 'loss' as const, mistakes: { replies: 10, toWin: 9, toDrawOrBetter: 9 } };
    expect(compareMoves(a, loss, 'exact')).toBeLessThan(0);
  });
});

describe('スケジューラ', () => {
  it('タスクを二重に発行せず、複数同時に配っても結果が同じになる', () => {
    const r = makeRng(37);
    for (let i = 0; i < 15; i++) {
      const pos = randomPosition(r, { plus: true }, 4);
      const worlds = makeWorlds(pos, worldOpts(i));
      const serial = analyzeSync(pos, worlds);

      const ctx = createContext(pos, worlds);
      let a = startAnalysis(pos, worlds);
      const seen = new Set<string>();
      for (;;) {
        const batch = nextTasks(a, 4);
        if (batch.length === 0) break;
        for (const t of batch) {
          expect(seen.has(t.id)).toBe(false);
          seen.add(t.id);
        }
        a = markIssued(a, batch);
        // 逆順で結果を返す(ワーカーからの到着順は不定)
        for (const t of [...batch].reverse()) a = applyResult(a, runTask(ctx, t));
      }
      expect(rankedMoves(a).map((m) => [m.move, m.cls, m.value, m.mistakes])).toEqual(
        rankedMoves(serial).map((m) => [m.move, m.cls, m.value, m.mistakes]),
      );
    }
  });

  it('勝ちの手が見つかった後は「勝ちかどうか」だけを調べ、最後に表示用の分類を埋める', () => {
    const r = makeRng(41);
    let sawWinOnly = false;
    for (let i = 0; i < 60 && !sawWinOnly; i++) {
      const pos = randomPosition(r, {}, 4);
      const worlds = makeWorlds(pos, worldOpts(i));
      const ctx = createContext(pos, worlds);
      let a = startAnalysis(pos, worlds);
      const modes: string[] = [];
      for (;;) {
        const [t] = nextTasks(a, 1) as Task[];
        if (!t) break;
        if (t.kind === 'classify') modes.push(t.mode);
        a = applyResult(markIssued(a, [t]), runTask(ctx, t));
      }
      if (modes.includes('winOnly')) {
        sawWinOnly = true;
        expect(a.moves.every((m) => m.cls !== 'notWin' && m.cls !== undefined)).toBe(true);
      }
    }
    expect(sawWinOnly).toBe(true);
  });
});

describe('非公開手札の解析', () => {
  function hidePool(pos: Position, r: Rng, known: number, extra: number): Position {
    const opp = pos.oppKnown;
    const cards = pos.cards.slice();
    const pool = opp.slice(known);
    for (let i = 0; i < extra; i++) {
      cards.push(randomCard(r, [1, 2, 3, 9, 10]));
      pool.push(cards.length - 1);
    }
    return { ...pos, cards, oppKnown: opp.slice(0, known), oppPool: pool, oppUnknown: opp.length - known };
  }

  it('候補リストがあれば保証クラスを出し、最上位が勝ち以外なら具体的な手札を全列挙して集計する', () => {
    const r = makeRng(43);
    let tallied = 0;
    for (let i = 0; i < 25; i++) {
      const pos = hidePool(randomPosition(r, { same: true }, 4), r, 1, 2);
      expect(guaranteeKind(pos)).toBe('pool');
      const worlds = makeWorlds(pos, worldOpts(i));
      expect(worlds.length).toBe(combinations(pos.oppPool, pos.oppUnknown).length);
      const a = analyzeSync(pos, worlds);
      const top = topClass(a)!;
      for (const m of a.moves) {
        if (m.cls === top && top !== 'win') {
          expect(m.worlds!.n).toBe(worlds.length);
          expect(m.worlds!.win + m.worlds!.draw + m.worlds!.loss).toBe(worlds.length);
          // 保証が引き分け以上なら、どの具体的な手札でも負けない
          if (top === 'draw') expect(m.worlds!.loss).toBe(0);
          tallied++;
        }
      }
    }
    expect(tallied).toBeGreaterThan(0);
  });

  it('候補が無ければ推定のみ(保証クラスは出さない)', () => {
    const r = makeRng(47);
    const pos = { ...randomPosition(r, {}, 4), oppKnown: [], oppPool: [], oppUnknown: 3 };
    // 相手の既知カードを消したので、盤面に無いカードだけが不明
    expect(guaranteeKind(pos)).toBe('estimate');
    const worlds = makeWorlds(pos, worldOpts(1));
    expect(worlds.length).toBe(6);
    expect(worlds.every((w) => !w.enumerated && w.oppHand.length === 3)).toBe(true);
    const a = analyzeSync(pos, worlds);
    expect(a.moves.every((m) => m.cls === undefined && m.worlds!.n === 6)).toBe(true);
    expect(recommended(a)).not.toBeNull();
  });
});

describe('カオス', () => {
  /** 参照エンジンによる独立した期待値計算(自分視点の勝ち/引き分けの確率) */
  function expectRef(state: RefState, hands: number[][], turn: Player, first: Player): { u: number; w: number; d: number } {
    if (state.board.every((c) => c !== null)) {
      const s = scoreRef(state, first);
      return { u: s.me > s.opp ? 1 : s.me === s.opp ? 0.5 : 0, w: s.me > s.opp ? 1 : 0, d: s.me === s.opp ? 1 : 0 };
    }
    let u = 0;
    let w = 0;
    let d = 0;
    for (const card of hands[turn]) {
      const best = bestRef(state, hands, turn, first, card);
      u += best.u;
      w += best.w;
      d += best.d;
    }
    const n = hands[turn].length;
    return { u: u / n, w: w / n, d: d / n };
  }

  function bestRef(state: RefState, hands: number[][], turn: Player, first: Player, card: number) {
    let best: { u: number; w: number; d: number } | null = null;
    const next = hands.map((h, p) => (p === turn ? h.filter((c) => c !== card) : h));
    state.board.forEach((c, cell) => {
      if (c !== null) return;
      const v = expectRef(placeRef(state, turn, card, cell).state, next, (turn ^ 1) as Player, first);
      if (best === null || (turn === 0 ? v.u > best.u : v.u < best.u)) best = v;
    });
    return best!;
  }

  it('厳密計算が、参照エンジンによる独立実装と一致する', () => {
    const r = makeRng(53);
    for (let i = 0; i < 12; i++) {
      const base = randomPosition(r, { same: true, plus: true, pick: 'chaos' }, 5 + (i % 2));
      const pos: Position = { ...base, forcedCard: base.myHand[Math.floor(r() * base.myHand.length)] };
      expect(guaranteeKind(pos)).toBe('chaos');
      const a = analyzeSync(pos, []);
      expect(a.chaosExact).toBe(true);

      let state = emptyState(pos.cards, pos.rules, pos.options);
      state = { ...state, board: pos.board.map((c) => (c ? { card: c.card, owner: c.owner } : null)) };
      for (const m of a.moves) {
        expect(m.move.card).toBe(pos.forcedCard);
        const after = placeRef(state, 0, m.move.card, m.move.cell).state;
        const hands = [pos.myHand.filter((c) => c !== m.move.card), pos.oppKnown];
        const ref = expectRef(after, hands, 1, pos.first);
        expect(m.chaos!.win).toBeCloseTo(ref.w, 10);
        expect(m.chaos!.draw).toBeCloseTo(ref.d, 10);
        expect(m.chaos!.win + m.chaos!.draw + m.chaos!.loss).toBeCloseTo(1, 10);
      }
    }
  });

  it('悲観的下界は、厳密な分布と矛盾しない(引き分け以上を保証するなら負けの確率は 0)', () => {
    const r = makeRng(59);
    let guaranteed = 0;
    for (let i = 0; i < 30; i++) {
      const base = randomPosition(r, { plus: true, pick: 'chaos' }, 5);
      const pos: Position = { ...base, forcedCard: base.myHand[0] };
      const a = analyzeSync(pos, []);
      for (const m of a.moves) {
        expect(m.pessimistic).toBeDefined();
        if (m.pessimistic !== 'loss') {
          expect(m.chaos!.loss).toBeCloseTo(0, 10);
          guaranteed++;
        }
        if (m.pessimistic === 'win') expect(m.chaos!.win).toBeCloseTo(1, 10);
      }
    }
    expect(guaranteed).toBeGreaterThan(0);
  });

  it('厳密計算ができない時(相手の手札が不明)は、出る順をサンプリングした世界で推定する', () => {
    const r = makeRng(61);
    const base = randomPosition(r, { pick: 'chaos' }, 4);
    const pos: Position = { ...base, forcedCard: base.myHand[1], oppKnown: base.oppKnown.slice(0, 1), oppPool: [], oppUnknown: 2 };
    const worlds = makeChaosWorlds(pos, worldOpts(3));
    expect(worlds.every((w) => w.myOrder![0] === pos.forcedCard && w.oppHand.length === 3)).toBe(true);
    const a = analyzeSync(pos, worlds);
    expect(a.chaosExact).toBe(false);
    expect(a.moves.every((m) => m.worlds!.n === worlds.length)).toBe(true);
    expect(recommended(a)).not.toBeNull();
  });
});
