import { useMemo, useState } from 'react';
import { chaosExactFeasible } from '../core/analyze';
import { cardRefOf, needsForcedCard, orderForcedCard, replay, toPosition, type MatchEvent, type MatchSetup, type RevealRef } from '../core/match';
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
import { AnalysisPanel } from './AnalysisPanel';
import { Board } from './Board';
import { CardEditor } from './CardEditor';
import { CardView } from './CardView';
import { Modal } from './Modal';

interface Props {
  setup: MatchSetup;
  events: MatchEvent[];
  priorLevel: PriorLevel;
  saved: SavedData;
  onEvents: (next: MatchEvent[]) => void;
  onRematch: (next: MatchSetup) => void;
  onNewMatch: () => void;
  onSaved: (next: SavedData) => void;
}

export function PlayScreen({ setup, events, priorLevel, saved, onEvents, onRematch, onNewMatch, onSaved }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [adhoc, setAdhoc] = useState<CardDef | null>(null);
  // reveal = 相手の裏向きの手札を開く、mismatch = 入力した手札と違うカードが出た
  const [picker, setPicker] = useState<'reveal-pool' | 'reveal-editor' | 'mismatch' | null>(null);
  const [fixMode, setFixMode] = useState(false);
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

  const onCell = (cell: number) => {
    const c = view.state.board[cell];
    if (fixMode) {
      if (c) onEvents([...events.slice(0, view.applied), { t: 'setOwner', cell, owner: (c.owner ^ 1) as Player }]);
      return;
    }
    if (c || view.finished) return;
    place(view.turn, cell, selected, adhoc);
  };

  const apply = (m: MoveEval) => place(0, m.move.cell, m.move.card, null);

  const undo = () => {
    onEvents(events.slice(0, Math.max(0, view.applied - 1)));
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

  const baseCount = setup.myHand.length + setup.oppSlots.filter((c) => c !== null).length + setup.oppPool.length;
  const unlisted = view.cards.slice(baseCount);
  const npcKey = setup.npcId !== undefined ? String(setup.npcId) : null;
  const rematch = buildRematch(setup, view);
  const canPlace = !view.finished && !fixMode && (selected !== null || adhoc !== null);

  const prompt = view.finished
    ? ''
    : myTurn
      ? forcedMode && forcedCard === undefined
        ? 'あなたの番です。ゲームに指定されたカードをタップしてください'
        : 'あなたの番です'
      : selected !== null || adhoc
        ? '相手が置いたマスをタップしてください'
        : '相手の番です。相手が出したカードをタップしてください';

  return (
    <main className="play">
      <div className="toolbar">
        <div className="rule-summary">
          {setup.round > 0 && <span className="chip chip-on">サドンデス 再戦 {setup.round} 回目</span>}
          {ruleIdsOf(setup.rules).map((id) => <span className="chip chip-static" key={id}>{RULE_NAMES[id]}</span>)}
          {ruleIdsOf(setup.rules).length === 0 && <span className="muted">追加ルールなし</span>}
        </div>
        <div className="toolbar-actions">
          <button type="button" className="btn-quiet" onClick={undo} disabled={view.applied === 0}>1 手戻す</button>
          <button type="button" className={`btn-quiet${fixMode ? ' is-on' : ''}`} aria-pressed={fixMode} onClick={() => setFixMode(!fixMode)}>所有を修正</button>
          <button type="button" className="btn-quiet" onClick={onNewMatch}>設定に戻る</button>
        </div>
      </div>

      {fixMode && <p className="note note-warn">盤面のカードをタップすると、青と赤が入れ替わります。ゲームの表示に合わせてください。</p>}
      {view.overridden && (
        <p className="note note-warn">
          ルールの想定がゲームと食い違いました。以降の「確定」「保証」は参考としてください。
          <button type="button" className="btn-quiet" onClick={copyDiscrepancy}>{copied ? 'コピーしました' : '食い違いをコピー'}</button>
        </p>
      )}
      {view.outOfPool && <p className="note note-warn">入力や候補リストに無いカードが出ました。それまでの保証は成り立っていませんでした。</p>}

      <div className="table-layout">
        <div className="table-side">
          <div className="hand-row hand-opp" aria-label="相手の手札">
            {view.oppKnown.map((i) => (
              <CardView key={i} card={view.cards[i]} owner={1} size="sm" shift={shiftOf(i)} selected={selected === i}
                dimmed={myTurn || view.finished}
                onClick={!myTurn && !view.finished ? () => { setAdhoc(null); setSelected(selected === i ? null : i); } : undefined} />
            ))}
            {Array.from({ length: view.oppUnknown }, (_, k) => (
              <CardView key={`u${k}`} card={null} owner={1} size="sm" dimmed={view.finished}
                onClick={view.finished ? undefined : openReveal} ariaLabel="相手の裏向きのカードを入力" />
            ))}
          </div>
          {!view.finished && view.oppUnknown > 0 && setup.rules.open !== 'none' && (
            <p className="note">
              {setup.rules.open === 'all' ? 'オールオープン' : 'スリーオープン'}で見えているカードは、「?」をタップして入れてください。相手の手札が全て分かると「確定」で読めます。
            </p>
          )}
          {!myTurn && !view.finished && view.oppUnknown === 0 && (
            <p className="hand-extra">
              <button type="button" className="btn-quiet" onClick={() => setPicker('mismatch')}>入力と違うカードが出た</button>
            </p>
          )}
          {adhoc && <p className="note">出たカード: {adhoc.label ?? adhoc.sides.join('/')}。置かれたマスをタップしてください。</p>}

          <Board view={view} shiftOf={shiftOf} recommendedCell={recommendedMove && myTurn ? recommendedMove.move.cell : null} canPlace={canPlace} fixMode={fixMode} onCell={onCell} />

          <div className="hand-row hand-my" aria-label="自分の手札">
            {view.myHand.map((i) => {
              const locked = orderCard !== null && orderCard !== i;
              return (
                <CardView key={i} card={view.cards[i]} owner={0} shift={shiftOf(i)} selected={selected === i}
                  recommended={myTurn && recommendedMove?.move.card === i}
                  dimmed={!myTurn || locked} onClick={myTurn && !locked ? () => setSelected(selected === i && !forcedMode ? null : i) : undefined} />
              );
            })}
          </div>
          <p className="prompt">{prompt}</p>
        </div>

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
                <button type="button" className="btn-quiet" onClick={() => onSaved(learnCards(saved, npcKey, unlisted, []))}>
                  リストに無かったカード {unlisted.length} 枚を、この NPC の候補に追加
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={onNewMatch}>同じ相手ともう一戦</button>
            </section>
          )}
          {myTurn && position && <AnalysisPanel solver={solver} cards={view.cards} onApply={apply} />}
        </div>
      </div>

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
          <button type="button" className="btn-quiet" onClick={() => setPicker('reveal-editor')}>リストに無いカードだった</button>
        </Modal>
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
