import { useEffect, useMemo, useState } from 'react';
import { chaosExactFeasible } from '../core/analyze';
import { toggleRule } from '../core/appState';
import { cardRefOf, needsForcedCard, orderForcedCard, replay, toPosition, type MatchEvent, type MatchSetup, type RevealRef, type SwapRef } from '../core/match';
import { guaranteeKind, placedCount, positionKey, type Position } from '../core/position';
import { learnCards, type SavedData } from '../core/presets';
import { recommended } from '../core/rank';
import { hashSeed, makeRng } from '../core/rng';
import { RULE_NAMES, ruleIdsOf, typeSign } from '../core/rules';
import type { MoveEval } from '../core/scheduler';
import { buildRematch, MAX_REMATCHES } from '../core/suddenDeath';
import type { CardDef, Player } from '../core/types';
import { makeChaosWorlds, makeWorlds, type World } from '../core/worlds';
import { samplePriorCard, type PriorLevel } from '../data';
import { useSolver } from '../hooks/useSolver';
import { BestMove, MoveTable } from './AnalysisPanel';
import { Board } from './Board';
import { CardEditor } from './CardEditor';
import { CardView } from './CardView';
import { ConfirmAction } from './ConfirmAction';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { RuleChips } from './RuleChips';

interface Props {
  setup: MatchSetup;
  events: MatchEvent[];
  priorLevel: PriorLevel;
  saved: SavedData;
  onEvents: (next: MatchEvent[]) => void;
  onRematch: (next: MatchSetup) => void;
  onNewMatch: () => void;
  onSaved: (next: SavedData) => void;
  /** 先攻を変える(1 枚目を置くまで) */
  onFirst: (first: Player) => void;
  /** 同じ設定の最初の対局からやり直す */
  onRestart: () => void;
  /** ルールを変える。記録は残したまま、置いたカードを新しいルールで計算し直す */
  onRules: (ruleIds: number[], fallenAceInCombo: boolean) => void;
}

export function PlayScreen({ setup, events, priorLevel, saved, onEvents, onRematch, onNewMatch, onSaved, onFirst, onRestart, onRules }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [adhoc, setAdhoc] = useState<CardDef | null>(null);
  // reveal = 相手の裏向きの手札を開く、swap = スワップで来たカードを選ぶ、mismatch = 入力した手札と違うカードが出た
  const [picker, setPicker] = useState<'reveal-pool' | 'reveal-editor' | 'swap-pool' | 'swap-editor' | 'mismatch' | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  // スワップで相手から来たカード(渡す自分のカードを選ぶまで確定しない)
  const [swapIn, setSwapIn] = useState<{ ref: SwapRef; card: CardDef; index: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const view = useMemo(() => replay(setup, events), [setup, events]);
  const forcedMode = needsForcedCard(setup);
  const orderCard = orderForcedCard(setup, view);
  const myTurn = !view.finished && view.turn === 0;
  const sign = typeSign(setup.rules);
  const shiftOf = (i: number) => sign * view.state.typeCount[view.cards[i].type];

  // カオス等では、ゲームに指定されたカードをタップしてもらってから解析する
  const forcedCard = forcedMode && selected !== null && view.myHand.includes(selected) ? selected : undefined;
  const position: Position | null = useMemo(() => {
    if (!myTurn || (forcedMode && forcedCard === undefined)) return null;
    return toPosition(setup, view, forcedCard);
  }, [myTurn, forcedMode, forcedCard, setup, view]);

  const key = position ? positionKey(position) : '';
  const worlds: World[] = useMemo(() => {
    if (!position) return [];
    const kind = guaranteeKind(position);
    if (kind === 'exact') return [];
    const opt = {
      rng: makeRng(hashSeed(key)),
      maxEnumerate: 30,
      // 序盤は 1 つの世界を解くのが重いので、サンプル数を抑える
      samples: placedCount(position) < 2 ? 8 : 24,
      samplePrior: (r: () => number) => samplePriorCard(r, priorLevel),
    };
    if (kind === 'chaos') return chaosExactFeasible(position) ? [] : makeChaosWorlds(position, opt);
    return makeWorlds(position, opt);
    // position の中身は key に集約されている
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, priorLevel]);

  const solver = useSolver(position, worlds);

  const reset = () => {
    setSelected(null);
    setAdhoc(null);
    setPicker(null);
  };

  const place = (by: Player, cell: number, cardIndex: number | null, adhocCard: CardDef | null) => {
    const ref = adhocCard ? ({ from: 'adhoc', card: adhocCard } as const) : cardIndex !== null ? cardRefOf(setup, cardIndex, view.revealed) : null;
    if (!ref) return;
    onEvents([...events.slice(0, view.applied), { t: 'place', by, card: ref, cell }]);
    reset();
  };

  /**
   * 相手の裏向きの手札を 1 枚開く。cardIndex は開いた後の cards への添字
   * (候補から開くならその添字、手入力なら末尾に足される)。
   * 相手の番なら「今出したカード」であることが多いので、そのまま選んでマス待ちにする。
   */
  const reveal = (ref: RevealRef, cardIndex: number) => {
    onEvents([...events.slice(0, view.applied), { t: 'reveal', card: ref }]);
    setAdhoc(null);
    setPicker(null);
    if (!myTurn) setSelected(cardIndex);
  };

  const revealFromPool = (cardIndex: number) => {
    const ref = cardRefOf(setup, cardIndex, view.revealed);
    if (ref?.from === 'pool') reveal(ref, cardIndex);
  };

  const openReveal = () => setPicker(view.oppPool.length > 0 ? 'reveal-pool' : 'reveal-editor');

  const toggleSwap = () => {
    setSwapIn(null);
    setSwapMode(!swapMode);
    reset();
  };

  /** スワップ: 相手から来たカードを決める(まだ確定しない) */
  const takeFromOpp = (cardIndex: number) => {
    const ref = cardRefOf(setup, cardIndex, view.revealed);
    if (!ref || ref.from === 'my') return;
    setSwapIn({ ref, card: view.cards[cardIndex], index: cardIndex });
    setPicker(null);
  };

  /** スワップ: 相手に渡した自分のカードを決めて、入れ替えを確定する */
  const giveMyCard = (cardIndex: number) => {
    const ref = cardRefOf(setup, cardIndex, view.revealed);
    if (!swapIn || ref?.from !== 'my') return;
    onEvents([...events.slice(0, view.applied), { t: 'swap', mine: ref.index, theirs: swapIn.ref }]);
    setSwapMode(false);
    setSwapIn(null);
    reset();
  };

  const onCell = (cell: number) => {
    if (view.state.board[cell] || view.finished || swapMode) return;
    place(view.turn, cell, selected, adhoc);
  };

  const apply = (m: MoveEval) => place(0, m.move.cell, m.move.card, null);

  const undo = () => {
    onEvents(events.slice(0, Math.max(0, view.applied - 1)));
    reset();
  };

  // 置く前のスワップや開いたカードの記録は手番を見ないので、先攻を変えてもそのまま残る
  const chooseFirst = (first: Player) => {
    onFirst(first);
    reset();
  };

  const restart = () => {
    setSwapMode(false);
    setSwapIn(null);
    setCopied(false);
    reset();
    onRestart();
  };

  const ruleIds = ruleIdsOf(setup.rules);
  const changeRules = (ids: number[], fallenAceInCombo: boolean) => {
    onRules(ids, fallenAceInCombo);
    reset();
  };

  const copyDiscrepancy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ setup, events: events.slice(0, view.applied) }));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const recommendedMove = solver.analysis ? recommended(solver.analysis) : null;
  // 「おすすめ通りに打った」のボタンが出ている時だけ、Enter でも同じことをする
  const enterMove = myTurn && position && !swapMode && !solver.error ? recommendedMove : null;

  useEffect(() => {
    if (!enterMove) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (document.querySelector('dialog[open]')) return;
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== 'checkbox')) return;
      // マウスで押したボタン(「1 手戻す」など)にはフォーカスが残るので、既定の動作を止めないとそのボタンがもう一度押される
      e.preventDefault();
      apply(enterMove);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // apply は描画のたびに作り直されるので、依存配列は付けずに毎回付け直す
  });

  const baseCount = setup.myHand.length + setup.oppSlots.filter((c) => c !== null).length + setup.oppPool.length;
  const unlisted = view.cards.slice(baseCount);
  const npcKey = setup.npcId !== undefined ? String(setup.npcId) : null;
  const rematch = buildRematch(setup, view);
  const canPlace = !view.finished && !swapMode && (selected !== null || adhoc !== null);

  // 手番の案内は、タップする手札の隣に出す(相手の手札の下 / 自分の手札の上)。両方の枠を常に描いて、出たり消えたりで盤面が動かないようにする
  const oppBanner = view.finished || myTurn
    ? swapMode && !swapIn ? 'スワップ: 相手から来たカードをタップしてください' : ''
    : swapMode
      ? swapIn ? '' : 'スワップ: 相手から来たカードをタップしてください'
      : selected !== null || adhoc
        ? '相手が置いたマスをタップしてください'
        : '相手の番です。相手が出したカードをタップしてください';
  const myBanner = view.finished
    ? ''
    : swapMode
      ? swapIn ? `スワップ: 来たカードは ${swapIn.card.label ?? swapIn.card.sides.join('/')}。相手に渡した自分のカードをタップしてください` : ''
      : !myTurn
        ? ''
        : forcedMode && forcedCard === undefined
          ? 'あなたの番です。ゲームに指定されたカードをタップしてください'
          : selected !== null && !forcedMode
            ? '置いたマスをタップしてください'
            : 'あなたの番です';
  const inProgress = events.length > 0 && !view.finished;

  return (
    <main className="play">
      {/* 1 行目: ルールと画面の移動。「設定に戻る」は記録を閉じるので、対局中は 2 段階の確認にする */}
      <div className="match-bar">
        <div className="match-rules">
          {setup.round > 0 && <span className="chip chip-on">サドンデス 再戦 {setup.round} 回目</span>}
          <span className="match-rules-text">{ruleIds.length > 0 ? ruleIds.map((id) => RULE_NAMES[id]).join('・') : '追加ルールなし'}</span>
          <button type="button" className="btn-tertiary btn-sm" onClick={() => setRulesOpen(true)}>
            <Icon name="rules" />ルールを変更
          </button>
        </div>
        <div className="match-nav">
          {inProgress ? (
            <ConfirmAction className="btn-tertiary btn-sm" small label={<><Icon name="back" />設定に戻る</>} confirmLabel="対局を閉じて戻る" onConfirm={onNewMatch} />
          ) : (
            <button type="button" className="btn-tertiary btn-sm" onClick={onNewMatch}>
              <Icon name="back" />設定に戻る
            </button>
          )}
        </div>
      </div>
      {/* 2 行目: 対局の操作。先攻は 1 枚目を置くまでだけ出る */}
      <div className="toolbar-actions">
        {view.placed === 0 && !view.finished && (
          <div className="first-pick" title="1 枚目を置くまで変えられます">
            <span className="first-pick-label">先攻</span>
            <div className="segmented" role="group" aria-label="先攻(1 枚目を置くまで変えられます)">
              <button type="button" className={setup.first === 0 ? 'seg-on seg-blue' : ''} aria-pressed={setup.first === 0} onClick={() => chooseFirst(0)}>自分</button>
              <button type="button" className={setup.first === 1 ? 'seg-on seg-red' : ''} aria-pressed={setup.first === 1} onClick={() => chooseFirst(1)}>相手</button>
            </div>
          </div>
        )}
        <button type="button" className="tool-btn" onClick={undo} disabled={view.applied === 0}>
          <Icon name="undo" />1 手戻す
        </button>
        <button type="button" className="tool-btn" onClick={restart} disabled={events.length === 0 && setup.round === 0}>
          <Icon name="restart" />はじめから
        </button>
        {view.placed === 0 && !view.finished && (
          <button type="button" className={`tool-btn${swapMode ? ' is-on' : ''}`} aria-pressed={swapMode} onClick={toggleSwap}>
            <Icon name="swap" />スワップ
          </button>
        )}
      </div>
      {view.overridden && (
        <p className="note note-warn">
          ルールの想定がゲームと食い違いました。以降の「確定」「保証」は参考としてください。
          <button type="button" className="btn-tertiary" onClick={copyDiscrepancy}>{copied ? 'コピーしました' : '食い違いをコピー'}</button>
        </p>
      )}
      {view.outOfPool && <p className="note note-warn">入力や候補リストに無いカードが出ました。それまでの保証は成り立っていませんでした。</p>}

      <div className="table-layout">
        <div className="table-side">
          <div className="hand-row hand-opp" aria-label="相手の手札">
            {view.oppKnown.map((i) => (
              <CardView key={i} card={view.cards[i]} owner={1} size="sm" shift={shiftOf(i)} selected={swapMode ? swapIn?.index === i : selected === i}
                dimmed={swapMode ? false : myTurn || view.finished}
                onClick={swapMode ? () => takeFromOpp(i) : !myTurn && !view.finished ? () => { setAdhoc(null); setSelected(selected === i ? null : i); } : undefined} />
            ))}
            {Array.from({ length: view.oppUnknown }, (_, k) => (
              <CardView key={`u${k}`} card={null} owner={1} size="sm" dimmed={view.finished}
                onClick={view.finished ? undefined : swapMode ? () => setPicker(view.oppPool.length > 0 ? 'swap-pool' : 'swap-editor') : openReveal}
                ariaLabel={swapMode ? '相手から来たカードを入力' : '相手の裏向きのカードを入力'} />
            ))}
          </div>
          {!view.finished && !swapMode && view.oppUnknown > 0 && setup.rules.open !== 'none' && (
            <p className="note">
              {setup.rules.open === 'all' ? 'オールオープン' : 'スリーオープン'}で見えているカードは、「?」をタップして入れてください。相手の手札が全て分かると「確定」で読めます。
            </p>
          )}
          {!myTurn && !view.finished && view.oppUnknown === 0 && (
            <p className="hand-extra">
              <button type="button" className="btn-tertiary" onClick={() => setPicker('mismatch')}>入力と違うカードが出た</button>
            </p>
          )}
          {adhoc && <p className="note">出たカード: {adhoc.label ?? adhoc.sides.join('/')}。置かれたマスをタップしてください。</p>}
          <p className={`turn-banner${oppBanner ? ' turn-1' : ''}`} role="status">{oppBanner}</p>

          <Board view={view} shiftOf={shiftOf} recommendedCell={recommendedMove && myTurn ? recommendedMove.move.cell : null} canPlace={canPlace} onCell={onCell} />

          <p className={`turn-banner${myBanner ? ' turn-0' : ''}`} role="status">{myBanner}</p>
          <div className="hand-row hand-my" aria-label="自分の手札">
            {view.myHand.map((i) => {
              const locked = orderCard !== null && orderCard !== i;
              return (
                <CardView key={i} card={view.cards[i]} owner={0} shift={shiftOf(i)} selected={selected === i}
                  recommended={myTurn && recommendedMove?.move.card === i}
                  dimmed={swapMode ? !swapIn : !myTurn || locked}
                  onClick={swapMode ? (swapIn ? () => giveMyCard(i) : undefined) : myTurn && !locked ? () => setSelected(selected === i && !forcedMode ? null : i) : undefined} />
              );
            })}
          </div>
        </div>

        {/* おすすめの帯。スマホでは自分の手札の直下、PC では右列の上に来る(grid-area) */}
        {myTurn && position && !swapMode && <BestMove solver={solver} cards={view.cards} onApply={apply} />}

        <div className="table-main">
          {view.finished && view.score && (
            <section className={`panel result result-${view.outcome}`}>
              <p className="result-title">{view.outcome === 'win' ? '勝ち' : view.outcome === 'draw' ? '引き分け' : '負け'}</p>
              <p className="result-score">{view.score.me} 対 {view.score.opp}</p>
              {rematch && (
                <div className="rematch">
                  <p>サドンデスの再戦です。先攻はゲームの表示に合わせてください(交互になると想定しています)。</p>
                  <div className="segmented segmented-big">
                    <button type="button" className={rematch.first === 0 ? 'seg-on seg-blue' : ''} onClick={() => onRematch({ ...rematch, first: 0 })}>自分が先攻で再戦</button>
                    <button type="button" className={rematch.first === 1 ? 'seg-on seg-red' : ''} onClick={() => onRematch({ ...rematch, first: 1 })}>相手が先攻で再戦</button>
                  </div>
                </div>
              )}
              {view.outcome === 'draw' && setup.rules.suddenDeath && setup.round >= MAX_REMATCHES && <p>再戦は 5 回までです。この対戦は引き分けで終わります。</p>}
              {npcKey && unlisted.length > 0 && (
                <button type="button" className="btn btn-sm" onClick={() => onSaved(learnCards(saved, npcKey, unlisted, []))}>
                  リストに無かったカード {unlisted.length} 枚を、この NPC の候補に追加
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={onNewMatch}>同じ相手ともう一戦</button>
            </section>
          )}
          {myTurn && position && !swapMode && <MoveTable solver={solver} cards={view.cards} />}
        </div>
      </div>

      {rulesOpen && (
        <Modal title="ルールを変更" onClose={() => setRulesOpen(false)}>
          <p className="note">置いたカードも新しいルールで計算し直します。「はじめから」でもこのルールで始まります。</p>
          <RuleChips ruleIds={ruleIds} onToggle={(id) => changeRules(toggleRule(ruleIds, id), setup.options.fallenAceInCombo)} />
          {setup.rules.fallenAce && (setup.rules.same || setup.rules.plus) && (
            <label className="check">
              <input type="checkbox" checked={setup.options.fallenAceInCombo} onChange={(e) => changeRules(ruleIds, e.target.checked)} />
              コンボの連鎖中もエースキラーを有効にする(実機での検証例が無い挙動です。食い違ったら外してください)
            </label>
          )}
        </Modal>
      )}
      {picker === 'reveal-pool' && (
        <Modal title="相手のカード" onClose={() => setPicker(null)}>
          <p className="note">相手の手札に入れます。相手が今このカードを出したなら、続けて置かれたマスをタップしてください。</p>
          <div className="pool-row pool-pick">
            {view.oppPool.map((i) => (
              <div className="slot" key={i}>
                <CardView card={view.cards[i]} owner={1} shift={shiftOf(i)} onClick={() => revealFromPool(i)} />
              </div>
            ))}
          </div>
          <button type="button" className="btn-tertiary" onClick={() => setPicker('reveal-editor')}>リストに無いカードだった</button>
        </Modal>
      )}
      {picker === 'swap-pool' && (
        <Modal title="相手から来たカード" onClose={() => setPicker(null)}>
          <p className="note">スワップで自分の手札に来たカードです。このあと、相手に渡した自分のカードをタップしてください。</p>
          <div className="pool-row pool-pick">
            {view.oppPool.map((i) => (
              <div className="slot" key={i}>
                <CardView card={view.cards[i]} owner={1} shift={shiftOf(i)} onClick={() => takeFromOpp(i)} />
              </div>
            ))}
          </div>
          <button type="button" className="btn-tertiary" onClick={() => setPicker('swap-editor')}>リストに無いカードだった</button>
        </Modal>
      )}
      {picker === 'swap-editor' && (
        <CardEditor title="相手から来たカード" owner={1} typeMatters={setup.rules.typeShift !== 'none'}
          onCommit={(card) => { setSwapIn({ ref: { from: 'adhoc', card }, card, index: -1 }); setPicker(null); }} onClose={() => setPicker(null)} />
      )}
      {picker === 'reveal-editor' && (
        <CardEditor title="相手のカード" owner={1} typeMatters={setup.rules.typeShift !== 'none'}
          onCommit={(card) => reveal({ from: 'adhoc', card }, view.cards.length)} onClose={() => setPicker(null)} />
      )}
      {picker === 'mismatch' && (
        <CardEditor title="相手が出したカード" owner={1} typeMatters={setup.rules.typeShift !== 'none'}
          onCommit={(card) => { setSelected(null); setAdhoc(card); setPicker(null); }} onClose={() => setPicker(null)} />
      )}
    </main>
  );
}
