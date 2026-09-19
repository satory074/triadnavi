import { describe, expect, it } from 'vitest';
import { emptyState, placeRef, scoreRef, type Flip, type RefState } from './refEngine';
import { DEFAULT_OPTIONS, NO_RULES, type CardDef, type CardType, type EngineOptions, type Player, type RuleSet } from './types';

const ME: Player = 0;
const OPP: Player = 1;

function c(t: number, r: number, b: number, l: number, type: CardType = 0): CardDef {
  return { sides: [t, r, b, l], type };
}

/** [誰が, カード, マス] の列を順に置く。最後の手の裏返りと最終状態を返す */
function play(
  rules: Partial<RuleSet>,
  moves: [Player, CardDef, number][],
  options: EngineOptions = DEFAULT_OPTIONS,
): { state: RefState; flips: Flip[]; owners: (Player | null)[] } {
  const cards = moves.map((m) => m[1]);
  let state = emptyState(cards, { ...NO_RULES, ...rules }, options);
  let flips: Flip[] = [];
  moves.forEach(([by, , cell], i) => {
    const r = placeRef(state, by, i, cell);
    state = r.state;
    flips = r.flips;
  });
  return { state, flips, owners: state.board.map((x) => (x ? x.owner : null)) };
}

const cellsOf = (flips: Flip[], cause?: string) =>
  flips.filter((f) => !cause || f.cause === cause).map((f) => f.cell).sort((a, b) => a - b);

describe('基本ルール', () => {
  it('対面の辺が厳密に大きければ支配する', () => {
    const r = play({}, [[OPP, c(5, 5, 5, 5), 4], [ME, c(1, 1, 1, 6), 5]]);
    expect(cellsOf(r.flips)).toEqual([4]);
    expect(r.owners[4]).toBe(ME);
  });

  it('同値では何も起きない', () => {
    const r = play({}, [[OPP, c(5, 5, 5, 5), 4], [ME, c(1, 1, 1, 5), 5]]);
    expect(r.flips).toEqual([]);
    expect(r.owners[4]).toBe(OPP);
  });

  it('弱いカードを置いても、置いた瞬間に自分が取られることはない', () => {
    const r = play({}, [[OPP, c(9, 9, 9, 9), 4], [ME, c(1, 1, 1, 1), 5]]);
    expect(r.flips).toEqual([]);
    expect(r.owners[5]).toBe(ME);
  });

  it('辺の向き: 上に置いたカードの「下」が、中央のカードの「上」と比べられる', () => {
    // 中央の上=2 だけが弱い。上のマスに置くカードは下=3 だけが強い
    const r = play({}, [[OPP, c(2, 9, 9, 9), 4], [ME, c(1, 1, 3, 1), 1]]);
    expect(cellsOf(r.flips)).toEqual([4]);
  });

  it('自分のカードは支配の対象にならない', () => {
    const r = play({}, [[ME, c(1, 1, 1, 1), 4], [ME, c(9, 9, 9, 9), 5]]);
    expect(r.flips).toEqual([]);
  });

  it('盤の端は作用しない(セイムウォールは FF14 に無い)', () => {
    // 角に置いた A を含むカード。隣は 1 枚だけで、その 1 辺が一致してもセイムは成立しない
    const r = play({ same: true }, [[OPP, c(1, 1, 1, 10), 1], [ME, c(10, 10, 1, 10), 0]]);
    expect(r.flips).toEqual([]);
  });
});

describe('セイム', () => {
  it('一致する数値同士が等しくなくてよい(上 4=4、左 9=9)', () => {
    const r = play({ same: true }, [
      [OPP, c(1, 1, 4, 1), 1],
      [OPP, c(1, 9, 1, 1), 3],
      [ME, c(4, 1, 1, 9), 4],
    ]);
    expect(cellsOf(r.flips, 'same')).toEqual([1, 3]);
  });

  it('自分のカードも 2 辺の条件に数えるが、裏返るのは相手のカードだけ', () => {
    const r = play({ same: true }, [
      [ME, c(1, 1, 4, 1), 1],
      [OPP, c(1, 9, 1, 1), 3],
      [ME, c(4, 1, 1, 9), 4],
    ]);
    expect(cellsOf(r.flips)).toEqual([3]);
    expect(r.flips[0].cause).toBe('same');
  });

  it('一致した隣が全て自分のカードなら何も起きず、コンボも無い', () => {
    const r = play({ same: true }, [
      [ME, c(1, 9, 4, 1), 1],
      [ME, c(1, 9, 1, 1), 3],
      [OPP, c(1, 1, 1, 2), 2], // マス 1 の右 9 に対して左 2。コンボが誤って走れば取られる
      [ME, c(4, 1, 1, 9), 4],
    ]);
    expect(r.flips).toEqual([]);
    expect(r.owners[2]).toBe(OPP);
  });

  it('一致が 1 辺だけでは成立しない', () => {
    const r = play({ same: true }, [
      [OPP, c(1, 1, 4, 1), 1],
      [OPP, c(1, 8, 1, 1), 3],
      [ME, c(4, 1, 1, 7), 4],
    ]);
    expect(r.flips).toEqual([]);
  });

  it('セイムが無効なら一致しても何も起きない', () => {
    const r = play({}, [
      [OPP, c(1, 1, 4, 1), 1],
      [OPP, c(1, 9, 1, 1), 3],
      [ME, c(4, 1, 1, 9), 4],
    ]);
    expect(r.flips).toEqual([]);
  });
});

describe('プラス', () => {
  it('和が等しい 2 辺の相手カードを支配する', () => {
    // 上 3+4=7、右 2+5=7。通常支配は成立しない値にしてある
    const r = play({ plus: true }, [
      [OPP, c(1, 1, 4, 1), 1],
      [OPP, c(1, 1, 1, 5), 5],
      [ME, c(3, 2, 1, 1), 4],
    ]);
    expect(cellsOf(r.flips, 'plus')).toEqual([1, 5]);
  });

  it('和のグループが 2 つ同時に成立する(7,7 と 11,11)', () => {
    const r = play({ plus: true }, [
      [OPP, c(1, 1, 4, 1), 1],
      [OPP, c(1, 1, 1, 5), 5],
      [OPP, c(6, 1, 1, 1), 7],
      [OPP, c(1, 7, 1, 1), 3],
      [ME, c(3, 2, 5, 4), 4],
    ]);
    expect(cellsOf(r.flips, 'plus')).toEqual([1, 3, 5, 7]);
  });

  it('自分のカードもグループの数に入るが裏返らない', () => {
    const r = play({ plus: true }, [
      [ME, c(1, 1, 4, 1), 1],
      [OPP, c(1, 1, 1, 5), 5],
      [ME, c(3, 2, 1, 1), 4],
    ]);
    expect(cellsOf(r.flips)).toEqual([5]);
    expect(r.flips[0].cause).toBe('plus');
  });

  it('3 辺のうち 2 辺だけ和が等しければ、その 2 辺だけ', () => {
    const r = play({ plus: true }, [
      [OPP, c(1, 1, 4, 1), 1], // 3+4=7
      [OPP, c(1, 1, 1, 5), 5], // 2+5=7
      [OPP, c(9, 1, 1, 1), 7], // 1+9=10
      [ME, c(3, 2, 1, 1), 4],
    ]);
    expect(cellsOf(r.flips)).toEqual([1, 5]);
  });
});

describe('コンボ', () => {
  it('セイムで取ったカードが、通常ルールで隣を取り連鎖する(検証用の手動テスト対局と同じ局面)', () => {
    const r = play({ same: true, plus: true }, [
      [OPP, c(1, 2, 1, 1), 0],
      [ME, c(1, 1, 1, 1), 8],
      [OPP, c(3, 3, 4, 5), 1],
      [ME, c(5, 1, 1, 1), 6],
      [OPP, c(2, 9, 2, 2), 3],
      [ME, c(4, 1, 1, 9), 4],
    ]);
    expect(cellsOf(r.flips, 'same')).toEqual([1, 3]);
    expect(cellsOf(r.flips, 'combo')).toEqual([0]);
    expect(r.flips.find((f) => f.cell === 0)!.gen).toBe(1);
    expect(r.owners.filter((o) => o === ME).length).toBe(6);
    expect(r.owners.filter((o) => o === OPP).length).toBe(0);
  });

  it('コンボ中にセイムは再発動しない', () => {
    // マス 1 のカードは左右とも 5=5 で一致するが、通常ルールでは取れない
    const r = play({ same: true }, [
      [OPP, c(1, 5, 9, 1), 0],
      [OPP, c(1, 1, 1, 5), 2],
      [OPP, c(1, 5, 4, 5), 1],
      [OPP, c(1, 9, 1, 1), 3],
      [ME, c(4, 1, 1, 9), 4],
    ]);
    expect(cellsOf(r.flips)).toEqual([1, 3]);
    expect(r.owners[0]).toBe(OPP);
    expect(r.owners[2]).toBe(OPP);
  });

  it('置いたカードの通常支配はコンボの起点にならない', () => {
    const r = play({ same: true }, [
      [OPP, c(1, 2, 1, 1), 0],
      [OPP, c(1, 1, 5, 9), 1], // 左 9 は マス 0 の右 2 より強いが、連鎖しない
      [ME, c(9, 1, 1, 1), 4],
    ]);
    expect(cellsOf(r.flips)).toEqual([1]);
    expect(r.flips[0].cause).toBe('basic');
    expect(r.owners[0]).toBe(OPP);
  });

  it('処理順の文書化: 通常支配されたカードは既に自分のものなので、コンボで取り直されず連鎖もしない', () => {
    // 未検証点。FFTriadBuddy と同じ「セイム/プラス → 通常支配 → コンボ」の順に従う。
    // もしゲームがコンボを先に解決するなら、マス 5 がコンボで取られて マス 8 まで連鎖するはず。
    const r = play({ same: true }, [
      [OPP, c(1, 8, 4, 1), 1], // セイム。右 8 で マス 2 をコンボ
      [OPP, c(1, 9, 1, 1), 3], // セイム
      [OPP, c(1, 1, 7, 3), 2], // コンボ 1 連鎖目で取られる。下 7 は マス 5 の上 2 より強い
      [OPP, c(2, 1, 8, 5), 5], // 置いたカードの右 9 > 左 5 で通常支配
      [OPP, c(1, 1, 1, 1), 8], // マス 5 の下 8 > 上 1。マス 5 が連鎖の起点になれば取られる
      [ME, c(4, 9, 1, 9), 4],
    ]);
    expect(cellsOf(r.flips, 'same')).toEqual([1, 3]);
    expect(cellsOf(r.flips, 'basic')).toEqual([5]);
    expect(cellsOf(r.flips, 'combo')).toEqual([2]);
    expect(r.owners[8]).toBe(OPP);
  });

  it('コンボは何連鎖でも続く', () => {
    const r = play({ same: true }, [
      [OPP, c(1, 8, 4, 1), 1],
      [OPP, c(1, 9, 1, 1), 3],
      [OPP, c(1, 1, 7, 3), 2],
      [OPP, c(2, 1, 8, 2), 5], // 左 2 対 置いたカードの右 1: 通常支配もセイムの一致も起きない
      [OPP, c(1, 1, 1, 1), 8],
      [ME, c(4, 1, 1, 9), 4],
    ]);
    expect(r.flips.filter((f) => f.cause === 'combo').map((f) => [f.cell, f.gen])).toEqual([[2, 1], [5, 2], [8, 3]]);
  });
});

describe('リバース', () => {
  it('小さい方が勝つ。同値は無効', () => {
    expect(cellsOf(play({ reverse: true }, [[OPP, c(5, 5, 5, 5), 4], [ME, c(1, 1, 1, 4), 5]]).flips)).toEqual([4]);
    expect(play({ reverse: true }, [[OPP, c(5, 5, 5, 5), 4], [ME, c(1, 1, 1, 5), 5]]).flips).toEqual([]);
    expect(play({ reverse: true }, [[OPP, c(5, 5, 5, 5), 4], [ME, c(1, 1, 1, 6), 5]]).flips).toEqual([]);
  });

  it('コンボ連鎖中も有効(実機確認済み: FFTriadBuddy issue #86)', () => {
    const base: [Player, CardDef, number][] = [
      [OPP, c(1, 1, 4, 5), 1],
      [OPP, c(1, 9, 1, 1), 3],
    ];
    // マス 1 の左 5 対 マス 0 の右。リバースでは右が大きい時だけ取れる
    // マス 0 は マス 3 とも隣接する。下 1 対 マス 3 の上 1 は同値なので、そちらからも取られない
    const weaker = play({ same: true, reverse: true }, [[OPP, c(9, 2, 1, 9), 0], ...base, [ME, c(4, 1, 1, 9), 4]]);
    expect(weaker.owners[0]).toBe(OPP);
    const stronger = play({ same: true, reverse: true }, [[OPP, c(1, 8, 1, 1), 0], ...base, [ME, c(4, 1, 1, 9), 4]]);
    expect(cellsOf(stronger.flips, 'combo')).toEqual([0]);
  });
});

describe('エースキラー', () => {
  it('置いた側の 1 が A を支配できる', () => {
    expect(cellsOf(play({ fallenAce: true }, [[OPP, c(10, 10, 10, 10), 4], [ME, c(9, 9, 9, 1), 5]]).flips)).toEqual([4]);
  });

  it('無効なら 1 は A を取れない', () => {
    expect(play({}, [[OPP, c(10, 10, 10, 10), 4], [ME, c(9, 9, 9, 1), 5]]).flips).toEqual([]);
  });

  it('2 は A を取れない(1 だけの例外)', () => {
    expect(play({ fallenAce: true }, [[OPP, c(10, 10, 10, 10), 4], [ME, c(9, 9, 9, 2), 5]]).flips).toEqual([]);
  });

  it('リバース併用時は A が 1 を支配できる(ゲーム内テキストに明記)', () => {
    const rules = { fallenAce: true, reverse: true };
    expect(cellsOf(play(rules, [[OPP, c(1, 1, 1, 1), 4], [ME, c(5, 5, 5, 10), 5]]).flips)).toEqual([4]);
    // リバース単体では A は 1 を取れない
    expect(play({ reverse: true }, [[OPP, c(1, 1, 1, 1), 4], [ME, c(5, 5, 5, 10), 5]]).flips).toEqual([]);
    // 併用時も、リバース本来の「1 が A を取る」はそのまま
    expect(cellsOf(play(rules, [[OPP, c(10, 10, 10, 10), 4], [ME, c(5, 5, 5, 1), 5]]).flips)).toEqual([4]);
    // A 対 2 は取れない
    expect(play(rules, [[OPP, c(2, 2, 2, 2), 4], [ME, c(5, 5, 5, 10), 5]]).flips).toEqual([]);
  });

  it('コンボ連鎖中の適用は設定で切り替わる(未検証点。既定は有効)', () => {
    const moves: [Player, CardDef, number][] = [
      [OPP, c(9, 10, 9, 9), 0], // 右が A
      [OPP, c(9, 9, 4, 1), 1], // セイムで取られ、左 1 で マス 0 の A に挑む
      [OPP, c(9, 9, 9, 9), 3],
      [ME, c(4, 1, 1, 9), 4],
    ];
    const rules = { same: true, fallenAce: true };
    expect(play(rules, moves, { fallenAceInCombo: true }).owners[0]).toBe(ME);
    expect(play(rules, moves, { fallenAceInCombo: false }).owners[0]).toBe(OPP);
  });
});

describe('タイプアセンド/タイプディセンド', () => {
  const PRIMAL: CardType = 1;

  it('置くカードは「自分を含めない」同タイプ枚数で戦う', () => {
    // 蛮神が盤面に 1 枚ある状態で 2 枚目を置く → +1 で戦う(+2 ではない)
    const tie = play({ typeShift: 'asc' }, [
      [ME, c(1, 1, 1, 1, PRIMAL), 0],
      [OPP, c(6, 6, 6, 6), 4],
      [ME, c(1, 1, 1, 5, PRIMAL), 5], // 左 5+1=6 対 6 → 同値で取れない
    ]);
    expect(tie.flips).toEqual([]);
    const win = play({ typeShift: 'asc' }, [
      [ME, c(1, 1, 1, 1, PRIMAL), 0],
      [OPP, c(5, 5, 5, 5), 4],
      [ME, c(1, 1, 1, 5, PRIMAL), 5], // 6 対 5
    ]);
    expect(cellsOf(win.flips)).toEqual([4]);
  });

  it('1 枚目は補正なしで戦い、解決の後に枚数が増える', () => {
    const r = play({ typeShift: 'asc' }, [
      [OPP, c(5, 5, 5, 5), 4],
      [ME, c(1, 1, 1, 5, PRIMAL), 5],
    ]);
    expect(r.flips).toEqual([]);
    expect(r.state.typeCount[PRIMAL]).toBe(1);
  });

  it('盤面の同タイプの相手カードも同じ枚数で補正される', () => {
    // 相手の蛮神(右 8)が 1 枚。自分の蛮神(左 8)を置くと双方 +1 で 9 対 9 → 取れない
    const tie = play({ typeShift: 'asc' }, [
      [OPP, c(1, 8, 1, 1, PRIMAL), 4],
      [ME, c(1, 1, 1, 8, PRIMAL), 5],
    ]);
    expect(tie.flips).toEqual([]);
    // タイプなしの 9 は補正されないので、相手の 8+1=9 と同値
    const typeless = play({ typeShift: 'asc' }, [
      [OPP, c(1, 8, 1, 1, PRIMAL), 4],
      [ME, c(1, 1, 1, 9), 5],
    ]);
    expect(typeless.flips).toEqual([]);
  });

  it('10 でクランプ。「11」は A と同値で、A には勝てない', () => {
    const r = play({ typeShift: 'asc' }, [
      [ME, c(1, 1, 1, 1, PRIMAL), 0],
      [ME, c(1, 1, 1, 1, PRIMAL), 2],
      [OPP, c(10, 10, 10, 10), 4],
      [ME, c(1, 1, 1, 9, PRIMAL), 5], // 9+2=11 → 10
    ]);
    expect(r.flips).toEqual([]);
  });

  it('タイプディセンドは 1 でクランプ', () => {
    const r = play({ typeShift: 'desc' }, [
      [ME, c(9, 9, 9, 9, PRIMAL), 0],
      [ME, c(9, 9, 9, 9, PRIMAL), 2],
      [ME, c(9, 9, 9, 9, PRIMAL), 6],
      [OPP, c(1, 1, 1, 1), 4],
      [ME, c(9, 9, 9, 2, PRIMAL), 5], // 2-3 → 1 対 1 → 同値
    ]);
    expect(r.flips).toEqual([]);
  });

  it('タイプディセンドで弱くなった相手カードを取れる', () => {
    const r = play({ typeShift: 'desc' }, [
      [OPP, c(1, 1, 1, 1, PRIMAL), 0],
      [OPP, c(1, 8, 1, 1, PRIMAL), 4], // 盤面に蛮神 2 枚 → 右 8-2=6
      [ME, c(1, 1, 1, 7), 5],
    ]);
    expect(cellsOf(r.flips)).toEqual([4]);
  });

  it('セイムは補正後の値で判定する', () => {
    // 蛮神 1 枚が盤面にある。置く蛮神の上 3 → 4、左 8 → 9
    const r = play({ typeShift: 'asc', same: true }, [
      [ME, c(1, 1, 1, 1, PRIMAL), 8],
      [OPP, c(1, 1, 4, 1), 1],
      [OPP, c(1, 9, 1, 1), 3],
      [ME, c(3, 1, 1, 8, PRIMAL), 4],
    ]);
    expect(cellsOf(r.flips, 'same')).toEqual([1, 3]);
  });

  it('プラスは補正後の値で判定する', () => {
    // 置く蛮神は +1: 上 2→3、右 1→2。和は 3+4=7、2+5=7
    const r = play({ typeShift: 'asc', plus: true }, [
      [ME, c(1, 1, 1, 1, PRIMAL), 6],
      [OPP, c(1, 1, 4, 1), 1],
      [OPP, c(1, 1, 1, 5), 5],
      [ME, c(2, 1, 1, 1, PRIMAL), 4],
    ]);
    expect(cellsOf(r.flips, 'plus')).toEqual([1, 5]);
  });

  it('ルールが無効なら枚数は数えるが値は変わらない', () => {
    const r = play({}, [
      [ME, c(1, 1, 1, 1, PRIMAL), 0],
      [OPP, c(5, 5, 5, 5), 4],
      [ME, c(1, 1, 1, 5, PRIMAL), 5],
    ]);
    expect(r.flips).toEqual([]);
  });

  it('エースキラーは補正後の値に対して働く(未検証点。全ての比較は補正後、で一貫させる)', () => {
    // 置く蛮神の左 2 は ディセンド -1 で 1 になり、A を取れる
    const r = play({ typeShift: 'desc', fallenAce: true }, [
      [ME, c(9, 9, 9, 9, PRIMAL), 0],
      [OPP, c(10, 10, 10, 10), 4],
      [ME, c(9, 9, 9, 2, PRIMAL), 5],
    ]);
    expect(cellsOf(r.flips)).toEqual([4]);
  });
});

describe('採点', () => {
  it('10 枚で数える: 盤面 9 枚 + 後攻の手元の 1 枚', () => {
    // 何も裏返らない 9 手。先攻(自分)が 5 枚、後攻(相手)が 4 枚置く
    const weak = c(1, 1, 1, 1);
    const moves: [Player, CardDef, number][] = [];
    for (let i = 0; i < 9; i++) moves.push([i % 2 === 0 ? ME : OPP, weak, i]);
    const r = play({}, moves);
    expect(scoreRef(r.state, ME)).toEqual({ me: 5, opp: 5 });
  });

  it('自分が後攻なら手元の 1 枚は自分の得点', () => {
    const weak = c(1, 1, 1, 1);
    const moves: [Player, CardDef, number][] = [];
    for (let i = 0; i < 9; i++) moves.push([i % 2 === 0 ? OPP : ME, weak, i]);
    const r = play({}, moves);
    expect(scoreRef(r.state, OPP)).toEqual({ me: 5, opp: 5 });
  });
});

describe('入力の検証', () => {
  it('埋まっているマスには置けない', () => {
    const s = emptyState([c(1, 1, 1, 1), c(1, 1, 1, 1)], NO_RULES, DEFAULT_OPTIONS);
    const s2 = placeRef(s, ME, 0, 4).state;
    expect(() => placeRef(s2, OPP, 1, 4)).toThrow();
  });
});
