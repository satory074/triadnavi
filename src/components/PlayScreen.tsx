import { useEffect, useMemo, useState } from 'react';
import { chaosExactFeasible } from '../core/analyze';
import { toggleRule } from '../core/appState';
import { cardRefOf, needsForcedCard, orderForcedCard, replay, toPosition, unrevealCard, type MatchEvent, type MatchSetup, type MatchView, type RevealRef, type SwapRef } from '../core/match';
import { guaranteeKind, placedCount, positionKey, type Position } from '../core/position';
import { learnCards, type SavedData } from '../core/presets';
import { recommended } from '../core/rank';
import { hashSeed, makeRng } from '../core/rng';
import { ruleIdsOf, typeSign } from '../core/rules';
import type { MoveEval } from '../core/scheduler';
import { buildRematch, MAX_REMATCHES } from '../core/suddenDeath';
import type { CardDef, Player, RuleSet } from '../core/types';
import { makeChaosWorlds, makeWorlds, type World } from '../core/worlds';
import { makeHandSampler, priorKey, priorLabel, type HandPrior } from '../core/handPrior';
import { ALL_DECK_CARDS, toDeckCards } from '../data';
import { useSolver } from '../hooks/useSolver';
import { BestMove, MoveTable } from './AnalysisPanel';
import { Board } from './Board';
import { CardEditor } from './CardEditor';
import { CardView } from './CardView';
import { ConfirmAction } from './ConfirmAction';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { RuleChips } from './RuleChips';
import { RuleNames } from './RuleNames';

interface Props {
  setup: MatchSetup;
  events: MatchEvent[];
  /** 相手の裏向きの手札の想定(候補が足りない分の埋め方)。下書きから決まり、対局中は変わらない */
  prior: HandPrior;
  /** 対戦の種類の見出し(大会名など)。無ければ出さない */
  title?: string | null;
  saved: SavedData;
  onEvents: (next: MatchEvent[]) => void;
  onRematch: (next: MatchSetup) => void;
  /** 対局の記録を閉じて設定画面へ */
  onSetup: () => void;
  onSaved: (next: SavedData) => void;
  /** 先攻を変える(1 枚目を置くまで) */
  onFirst: (first: Player) => void;
  /** 同じ設定の最初の対局からやり直す */
  onRestart: () => void;
  /** ルールを変える。記録は残したまま、置いたカードを新しいルールで計算し直す */
  onRules: (ruleIds: number[], fallenAceInCombo: boolean) => void;
}

export function PlayScreen({ setup, events, prior, title, saved, onEvents, onRematch, onSetup, onSaved, onFirst, onRestart, onRules }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [adhoc, setAdhoc] = useState<CardDef | null>(null);
  // 候補に無いカードを数字で入れる。reveal = 見えている相手のカードを開く、swap = スワップで来たカード、played = 相手が出したカード
  const [picker, setPicker] = useState<'reveal-editor' | 'swap-editor' | 'played-editor' | null>(null);
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
  const priorId = priorKey(prior);
  // 候補が足りない分を埋めるカードの引き方。ルールが変わると「強さ」の並びが変わる(リバース)ので作り直す
  const sampler = useMemo(() => makeHandSampler(prior, ALL_DECK_CARDS, setup.rules), [priorId, setup.rules]); // eslint-disable-line react-hooks/exhaustive-deps
  const worlds: World[] = useMemo(() => {
    if (!position) return [];
    const kind = guaranteeKind(position);
    if (kind === 'exact') return [];
    const opt = {
      rng: makeRng(hashSeed(key)),
      maxEnumerate: 30,
      // 序盤は 1 つの世界を解くのが重いので、サンプル数を抑える
      samples: placedCount(position) < 2 ? 8 : 24,
      fill: (r: () => number, known: readonly CardDef[], count: number) => sampler(r, toDeckCards(known), count),
    };
    if (kind === 'chaos') return chaosExactFeasible(position) ? [] : makeChaosWorlds(position, opt);
    return makeWorlds(position, opt);
    // position の中身は key に集約されている
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sampler]);

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
   * 見えている相手のカード(オールオープン等)を、出される前に開く。自分の番だけ。
   * 開き間違いは、開いたカードの下の「戻す」で直す(unrevealCard)
   */
  const reveal = (ref: RevealRef) => {
    onEvents([...events.slice(0, view.applied), { t: 'reveal', card: ref }]);
    reset();
  };

  const revealFromPool = (cardIndex: number) => {
    const ref = cardRefOf(setup, cardIndex, view.revealed);
    if (ref?.from === 'pool') reveal(ref);
  };

  /** 相手が出したカードを選ぶ(マスをタップするまで記録しない。押し間違えたら押し直すだけ) */
  const pickPlayed = (cardIndex: number) => {
    setAdhoc(null);
    setSelected(selected === cardIndex ? null : cardIndex);
  };

  // 開いて、まだ出していないカード → 「戻す」を押した後の記録
  const revertible = useMemo(() => {
    const m = new Map<number, MatchEvent[]>();
    for (const i of view.oppKnown) {
      if (!view.revealed.includes(i)) continue;
      const next = unrevealCard(setup, events, i);
      if (next) m.set(i, next);
    }
    return m;
  }, [setup, events, view]);

  const unreveal = (cardIndex: number) => {
    const next = revertible.get(cardIndex);
    if (!next) return;
    onEvents(next);
    reset();
  };

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
    // オーダーの 1 局目は出すカードが決まっているので、選択より優先する(自分の番だけ。相手の手は従来どおり選んでもらう)
    const forcedNow = view.turn === 0 ? orderCard : null;
    place(view.turn, cell, forcedNow ?? selected, adhoc);
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
  const canRestart = events.length > 0 || setup.round > 0;

  // キーボード: Enter = おすすめ通りに打った、R = はじめから。ダイアログが開いている時と文字の入力中は効かない
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const t = e.target;
      if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type !== 'checkbox')) return;
      if (e.key === 'Enter' && !e.shiftKey && enterMove) {
        // マウスで押したボタン(「1 手戻す」など)にはフォーカスが残るので、既定の動作を止めないとそのボタンがもう一度押される
        e.preventDefault();
        apply(enterMove);
      } else if ((e.key === 'r' || e.key === 'R') && canRestart) {
        e.preventDefault();
        restart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // apply と restart は描画のたびに作り直されるので、依存配列は付けずに毎回付け直す
  });

  const baseCount = setup.myHand.length + setup.oppSlots.filter((c) => c !== null).length + setup.oppPool.length;
  const unlisted = view.cards.slice(baseCount);
  const npcKey = setup.npcId !== undefined ? String(setup.npcId) : null;
  const rematch = buildRematch(setup, view);
  // オーダー(1 局目)は出すカードが決まっているので、盤面のタップだけで置ける。myTurn を必ず挟む:
  // orderForcedCard は手番を見ないので、これが無いと相手の手を記録するタップで自分のカードが置かれる
  const orderPlaceable = myTurn && !swapMode && orderCard !== null;
  const canPlace = !view.finished && !swapMode && (selected !== null || adhoc !== null || orderPlaceable);

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
          // オーダー(1 局目)は出すカードが決まっているので、そのカード名を出してマスだけ押してもらう
          : orderCard !== null
            ? `オーダー: ${view.cards[orderCard].label ?? view.cards[orderCard].sides.join('/')} を置くマスをタップしてください`
          : selected !== null && !forcedMode
            ? '置いたマスをタップしてください'
            : 'あなたの番です';
  const inProgress = events.length > 0 && !view.finished;

  return (
    <main className="play">
      {/* 1 行目: ルールと画面の移動。「設定を変える」は記録を閉じるので、対局中は 2 段階の確認にする */}
      <div className="match-bar">
        <div className="match-rules">
          {title && <span className="chip chip-on">{title}</span>}
          {setup.round > 0 && <span className="chip chip-on">サドンデス 再戦 {setup.round} 回目</span>}
          <span className="match-rules-text">{ruleIds.length > 0 ? <RuleNames ids={ruleIds} /> : '追加ルールなし'}</span>
          <button type="button" className="btn-tertiary btn-sm" onClick={() => setRulesOpen(true)}>
            <Icon name="rules" />ルールを変更
          </button>
        </div>
        <div className="match-nav">
          {inProgress ? (
            <ConfirmAction className="btn-tertiary btn-sm" small label={<><Icon name="back" />設定を変える</>} confirmLabel="対局を閉じて設定へ" onConfirm={onSetup} />
          ) : (
            <button type="button" className="btn-tertiary btn-sm" onClick={onSetup}>
              <Icon name="back" />設定を変える
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
        <button type="button" className="tool-btn" onClick={restart} disabled={!canRestart} aria-keyshortcuts="R">
          <Icon name="restart" />はじめから
          <kbd className="key-hint">R</kbd>
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
            {view.oppKnown.map((i) => {
              const card = (
                <CardView key={i} card={view.cards[i]} owner={1} size="sm" shift={shiftOf(i)} selected={swapMode ? swapIn?.index === i : selected === i}
                  dimmed={swapMode ? false : myTurn || view.finished}
                  onClick={swapMode ? () => takeFromOpp(i) : !myTurn && !view.finished ? () => pickPlayed(i) : undefined} />
              );
              // 対局中に開いて、まだ出していないカードは「?」に戻せる(開き間違いの修正)
              return revertible.has(i) && !swapMode && !view.finished ? (
                <div className="slot" key={i}>
                  {card}
                  <button type="button" className="btn-tertiary slot-remove" onClick={() => unreveal(i)} aria-label={`開いた ${view.cards[i].label ?? view.cards[i].sides.join('/')} を「?」に戻す`}>戻す</button>
                </div>
              ) : card;
            })}
            {Array.from({ length: view.oppUnknown }, (_, k) => (
              <CardView key={`u${k}`} card={null} owner={1} size="sm" dimmed={view.finished} ariaLabel="相手の裏向きのカード" />
            ))}
          </div>
          {!view.finished && view.oppUnknown > 0 && (
            <OppPool view={view} shiftOf={shiftOf} myTurn={myTurn} swapMode={swapMode} open={setup.rules.open} prior={prior}
              selected={swapMode ? swapIn?.index ?? null : selected}
              onPick={swapMode ? takeFromOpp : !myTurn ? pickPlayed : setup.rules.open !== 'none' ? revealFromPool : null}
              onUnlisted={() => setPicker(swapMode ? 'swap-editor' : !myTurn ? 'played-editor' : 'reveal-editor')} />
          )}
          {!myTurn && !view.finished && !swapMode && view.oppUnknown === 0 && (
            <p className="hand-extra">
              <button type="button" className="btn-tertiary" onClick={() => setPicker('played-editor')}>入力と違うカードが出た</button>
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
                <CardView key={i} card={view.cards[i]} owner={0} shift={shiftOf(i)} selected={selected === i || (orderPlaceable && orderCard === i)}
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
              <button type="button" className="btn btn-primary" aria-keyshortcuts="R" onClick={() => { restart(); window.scrollTo(0, 0); }}>
                同じ相手ともう一戦
                <kbd className="key-hint">R</kbd>
              </button>
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
      {picker === 'swap-editor' && (
        <CardEditor title="相手から来たカード" owner={1} typeMatters={setup.rules.typeShift !== 'none'}
          onCommit={(card) => { setSwapIn({ ref: { from: 'adhoc', card }, card, index: -1 }); setPicker(null); }} onClose={() => setPicker(null)} />
      )}
      {picker === 'reveal-editor' && (
        <CardEditor title="見えている相手のカード" owner={1} typeMatters={setup.rules.typeShift !== 'none'}
          onCommit={(card) => reveal({ from: 'adhoc', card })} onClose={() => setPicker(null)} />
      )}
      {picker === 'played-editor' && (
        <CardEditor title="相手が出したカード" owner={1} typeMatters={setup.rules.typeShift !== 'none'}
          onCommit={(card) => { setSelected(null); setAdhoc(card); setPicker(null); }} onClose={() => setPicker(null)} />
      )}
    </main>
  );
}

interface OppPoolProps {
  view: MatchView;
  shiftOf: (i: number) => number;
  myTurn: boolean;
  swapMode: boolean;
  open: RuleSet['open'];
  prior: HandPrior;
  selected: number | null;
  /** 候補をタップした時。null = 押せない(自分の番でオープンが無い時。見えないカードは開く理由が無く、押し間違いの元になる) */
  onPick: ((cardIndex: number) => void) | null;
  /** 候補に無いカードを数字で入れる */
  onUnlisted: () => void;
}

/**
 * 相手の裏向きのカードに入りうる候補。最初から並べて、タップ 1 回で選べるようにしている(以前は「?」→ 一覧のダイアログ)。
 * タップの意味は親が決める: 相手の番 = 出したカード(マスを押すまで記録しない)、自分の番 = 見えているカードを開く、スワップ中 = 来たカード。
 * 手番のたびに盤面の位置が動かないよう、自分の番でも薄く出したままにし、案内は 1 行の見出しに収める。
 * 候補に無いカードのボタンは候補の列の最後のマスに置く(行を増やすと、スマホで盤面の下の段が画面から出る)
 */
function OppPool({ view, shiftOf, myTurn, swapMode, open, prior, selected, onPick, onUnlisted }: OppPoolProps) {
  const hasPool = view.oppPool.length > 0;
  const revealing = myTurn && !swapMode && open !== 'none';
  const head = revealing
    ? '見えているカードは、タップで相手の手札へ'
    : hasPool ? `候補(裏向きの ${view.oppUnknown} 枚はこの中のどれか)` : `裏向き ${view.oppUnknown} 枚(${prior.kind === 'level' ? '候補が分かりません' : priorLabel(prior)})`;
  const unlisted = swapMode
    ? hasPool ? 'リストに無いカードが来た' : '来たカードを数字で入れる'
    : !myTurn
      ? hasPool ? 'リストに無いカードを出した' : '出したカードを数字で入れる'
      : hasPool ? 'リストに無いカードが見えている' : '見えているカードを数字で入れる';
  return (
    <section className="opp-pool" aria-label="相手の候補のカード">
      <p className="opp-pool-head">{head}</p>
      {hasPool ? (
        <div className="opp-pool-row">
          {view.oppPool.map((i) => (
            <CardView key={i} card={view.cards[i]} owner={1} size="sm" showName={false} shift={shiftOf(i)} selected={selected === i} dimmed={!onPick}
              onClick={onPick ? () => onPick(i) : undefined} />
          ))}
          {onPick && (
            <button type="button" className="pool-unlisted" onClick={onUnlisted} aria-label={unlisted}>
              候補に無い
            </button>
          )}
        </div>
      ) : (
        onPick && (
          <p className="hand-extra">
            <button type="button" className="btn-tertiary btn-sm" onClick={onUnlisted}>{unlisted}</button>
          </p>
        )
      )}
    </section>
  );
}
