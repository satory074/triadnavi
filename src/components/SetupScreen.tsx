import { useState } from 'react';
import {
  applyNpc, applyOpenRuleset, applyTournament, clearNpc, clearOppSlot, revealPoolCard, selectableRules, setMode, setupProblems, setupWarnings, toggleRule, type MatchMode,
  type SetupDraft,
} from '../core/appState';
import { DECK_PROBLEM_TEXT, type Collection } from '../core/collection';
import { moveItem } from '../core/reorder';
import type { SavedData, SavedDeck } from '../core/presets';
import { renameDeck, sameCard } from '../core/presets';
import { RULE_ID, rulesFromIds } from '../core/rules';
import type { CardDef } from '../core/types';
import { competitionById, handProblems, npcById, npcCards, openRulesetById, openRulesetLabel, toCardDef, type NpcInfo } from '../data';
import { CardEditor } from './CardEditor';
import { CardView } from './CardView';
import { ConfirmAction } from './ConfirmAction';
import { DeckAdvisor } from './DeckAdvisor';
import { DeckPicker } from './DeckPicker';
import { DraftPanel } from './DraftPanel';
import { NpcPicker } from './NpcPicker';
import { OpenRulesetPicker } from './OpenRulesetPicker';
import { OpponentPanel } from './OpponentPanel';
import { RuleChips } from './RuleChips';
import { RuleNames } from './RuleNames';
import { TournamentPicker } from './TournamentPicker';
import { useMoveFocus, useReorder } from '../hooks/useReorder';

interface Props {
  draft: SetupDraft;
  saved: SavedData;
  collection: Collection;
  onDraft: (next: SetupDraft) => void;
  onSaved: (next: SavedData) => void;
  onStart: () => void;
  onOpenCollection: () => void;
}

type Target = { kind: 'my'; slot: number } | { kind: 'opp'; slot: number } | { kind: 'pool' };

const MODES: { mode: MatchMode; label: string }[] = [
  { mode: 'free', label: '通常' },
  { mode: 'tournament', label: '大会' },
  { mode: 'open', label: 'オフィシャルトーナメント' },
];

export function SetupScreen({ draft, saved, collection, onDraft, onSaved, onStart, onOpenCollection }: Props) {
  const [target, setTarget] = useState<Target | null>(null);
  const rules = rulesFromIds(draft.ruleIds);
  const typeMatters = rules.typeShift !== 'none';
  const problems = setupProblems(draft);
  const warnings = setupWarnings(draft);
  const competition = draft.mode === 'tournament' ? competitionById(draft.tournamentId) : undefined;
  const openRuleset = draft.mode === 'open' ? openRulesetById(draft.openRulesetId) : undefined;
  const drafting = draft.mode === 'open';
  const filled = draft.myCards.filter((c) => c !== null).length;
  // 大会の固定ルールと違うチップが選ばれている(ルーレットの大会は、対戦が始まってから結果を足すので除く)
  const ruleDrift = competition !== undefined && !competition.rules.includes(RULE_ID.roulette)
    && (JSON.stringify([...draft.ruleIds].sort((a, b) => a - b)) !== JSON.stringify(selectableRules(competition.rules).sort((a, b) => a - b))
      || draft.swap !== competition.rules.includes(RULE_ID.swap));

  const pickNpc = (npc: NpcInfo) => {
    const { fixed, variable } = npcCards(npc);
    onDraft(applyNpc(draft, { id: npc.id, fixed: fixed.map(toCardDef), variable: variable.map(toCardDef), rules: npc.rules }, saved.learned[String(npc.id)] ?? []));
  };

  const commit = (card: CardDef) => {
    if (!target) return;
    if (target.kind === 'my') {
      const myCards = draft.myCards.slice();
      myCards[target.slot] = card;
      onDraft({ ...draft, myCards });
      // 次の空きスロットへ自動で進む
      const next = myCards.findIndex((c, i) => c === null && i > target.slot);
      const wrap = next >= 0 ? next : myCards.indexOf(null);
      setTarget(wrap >= 0 ? { kind: 'my', slot: wrap } : null);
    } else if (target.kind === 'opp') {
      const prev = draft.oppCards[target.slot];
      const oppCards = draft.oppCards.slice();
      oppCards[target.slot] = card;
      // 候補にあるカードを手で入れた場合は候補から外す。入れ替えで外れた NPC の可変カードは候補へ戻す
      let oppPool = draft.oppPool.filter((c) => !sameCard(c, card));
      if (prev && isNpcVariable(draft.npcId, prev) && !oppPool.some((c) => sameCard(c, prev))) oppPool = [...oppPool, prev];
      onDraft({ ...draft, oppCards, oppPool });
      setTarget(null);
    } else {
      if (!draft.oppPool.some((c) => sameCard(c, card))) onDraft({ ...draft, oppPool: [...draft.oppPool, card].slice(0, 20) });
    }
  };

  // 手札の並べ替え。オーダーでは並び順がそのまま出す順になるので、入れ直さずに動かせるようにする
  const moveCard = (from: number, to: number) => {
    if (to < 0 || to >= draft.myCards.length) return;
    onDraft({ ...draft, myCards: moveItem(draft.myCards, from, to) });
  };
  const reorder = useReorder({ axis: 'x', count: draft.myCards.length, onMove: moveCard });
  const focus = useMoveFocus();
  const moveByButton = (from: number, to: number, side: 'l' | 'r') => {
    focus.after(`${to}:${side}`, `${to}:${side === 'l' ? 'r' : 'l'}`);
    moveCard(from, to);
  };

  const clearMy = (slot: number) => {
    const myCards = draft.myCards.slice();
    myCards[slot] = null;
    onDraft({ ...draft, myCards });
  };

  const clearOpp = (slot: number) => {
    const card = draft.oppCards[slot];
    if (!card) return;
    // NPC の可変カードなら候補へ戻す。固定カードや手入力のカードは外すだけ
    onDraft(clearOppSlot(draft, slot, isNpcVariable(draft.npcId, card)));
  };

  const saveDeck = (name: string) => {
    const deck: SavedDeck = { id: `${Date.now()}`, name, cards: draft.myCards as CardDef[] };
    onSaved({ ...saved, decks: [...saved.decks, deck] });
  };

  const title = target?.kind === 'my' ? `自分の手札 ${target.slot + 1} 枚目` : target?.kind === 'opp' ? `相手の手札 ${target.slot + 1} 枚目` : '候補のカードを追加';

  return (
    <main className="setup">
      <section>
        <h2>対戦の種類</h2>
        <div className="segmented" role="group" aria-label="対戦の種類">
          {MODES.map((m) => (
            <button type="button" key={m.mode} className={draft.mode === m.mode ? 'seg-on' : ''} aria-pressed={draft.mode === m.mode} onClick={() => onDraft(setMode(draft, m.mode))}>
              {m.label}
            </button>
          ))}
        </div>
        {draft.mode === 'tournament' && (
          <p className="note">ゴールドソーサーの大会(ランキング形式)。ルールは大会ごとに固定で、流行ルールは適用されません。相手はオートマッチングのプレイヤーか、カードバトルルームの NPC です。</p>
        )}
        {drafting && (
          <p className="note">8 人で 3 試合のオフィシャルトーナメント。ドラフト(提示された 3 つのセットから選ぶ × 3 回)で組んだデッキを、3 試合とも使います。</p>
        )}
      </section>

      <section>
        <h2>{draft.mode === 'tournament' ? '大会と相手' : drafting ? 'トーナメントのルール' : '対戦相手'}</h2>
        {draft.mode === 'tournament' ? (
          <TournamentPicker draft={draft} onPick={(t) => onDraft(applyTournament(draft, t))} onNpc={pickNpc} onPlayer={() => onDraft(clearNpc(draft))} />
        ) : drafting ? (
          <OpenRulesetPicker draft={draft} onPick={(r) => onDraft(applyOpenRuleset(draft, r))} />
        ) : (
          <NpcPicker npcId={draft.npcId} onPick={pickNpc} onClear={() => onDraft(clearNpc(draft))} />
        )}
      </section>

      <section>
        <h2>相手の手札</h2>
        <OpponentPanel
          draft={draft}
          orderActive={rules.pick === 'order'}
          onEditSlot={(slot) => setTarget({ kind: 'opp', slot })}
          onClearSlot={clearOpp}
          onReveal={(i) => onDraft(revealPoolCard(draft, i))}
          onAddCandidate={() => setTarget({ kind: 'pool' })}
          onRemoveCandidate={(i) => onDraft({ ...draft, oppPool: draft.oppPool.filter((_, k) => k !== i) })}
          onPriorLevel={(priorLevel) => onDraft({ ...draft, priorLevel })}
          onOrderKnown={(oppOrderKnown) => onDraft({ ...draft, oppOrderKnown })}
        />
      </section>

      <section>
        <h2>この対戦のルール</h2>
        {openRuleset && <p className="note">{openRulesetLabel(openRuleset)}。ドラフトは常に有効です。受付の表示と違えば、下で直してください。</p>}
        {competition && (
          <p className="note">
            {competition.name} の固定ルール: <RuleNames ids={competition.rules} />
            {ruleDrift && (
              <>
                {' '}
                <span className="note-warn">固定ルールと違うルールが選ばれています。</span>
                <button type="button" className="btn-tertiary btn-sm" onClick={() => onDraft(applyTournament(draft, competition))}>大会のルールに戻す</button>
              </>
            )}
          </p>
        )}
        <RuleChips ruleIds={draft.ruleIds} onToggle={(id) => onDraft({ ...draft, ruleIds: toggleRule(draft.ruleIds, id) })} swap={draft.swap} onSwap={(swap) => onDraft({ ...draft, swap })} />
        {rules.fallenAce && (rules.same || rules.plus) && (
          <label className="check">
            <input type="checkbox" checked={draft.fallenAceInCombo} onChange={(e) => onDraft({ ...draft, fallenAceInCombo: e.target.checked })} />
            コンボの連鎖中もエースキラーを有効にする(実機での検証例が無い挙動です。食い違ったら外してください)
          </label>
        )}
      </section>

      <section>
        <h2>{drafting ? 'ドラフトで組む自分の手札' : '自分の手札'}</h2>
        {drafting && filled < 5 && <DraftPanel draft={draft} onDraft={onDraft} />}
        <div className="hand-row">
          {draft.myCards.map((card, i) => {
            const { className, ...drag } = reorder.bind(i);
            return (
              <div className={`slot ${className}`} key={i} {...drag}>
                <CardView card={card} empty owner={0} onClick={() => setTarget({ kind: 'my', slot: i })} ariaLabel={card ? `自分の ${i + 1} 枚目を変更` : `自分の ${i + 1} 枚目を入力`} />
                <div className="slot-move">
                  <button type="button" className="btn-tertiary slot-move-btn" disabled={i === 0}
                    ref={focus.register(`${i}:l`)}
                    onClick={() => moveByButton(i, i - 1, 'l')} aria-label={`自分の ${i + 1} 枚目を左へ`}>←</button>
                  <button type="button" className="btn-tertiary slot-move-btn" disabled={i === draft.myCards.length - 1}
                    ref={focus.register(`${i}:r`)}
                    onClick={() => moveByButton(i, i + 1, 'r')} aria-label={`自分の ${i + 1} 枚目を右へ`}>→</button>
                </div>
                {card ? (
                  <button type="button" className="btn-tertiary slot-remove" onClick={() => clearMy(i)} aria-label={`自分の ${i + 1} 枚目を外す`}>外す</button>
                ) : (
                  <span className="slot-action">入力</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="note">札はドラッグでも、下の ← → でも並べ替えられます。</p>
        {/* ドラフトのデッキはレアリティの制限を見ない(貸し出しのカードで、★1〜★5 が 1 枚ずつ) */}
        {!drafting && handProblems(draft.myCards).map((p) => (
          <p className="note note-warn" key={p}>{DECK_PROBLEM_TEXT[p]}。ゲーム内ではこのデッキを組めません。</p>
        ))}
        {rules.pick === 'order' && <p className="note">オーダーでは左から順に出すことになります。デッキの並び順どおりに入れてください。</p>}
        {drafting ? (
          filled > 0 && (
            <p className="hand-extra">
              <ConfirmAction className="btn-tertiary btn-sm" small label="ドラフトをやり直す" confirmLabel="手札を空にする" onConfirm={() => onDraft({ ...draft, myCards: [null, null, null, null, null] })} />
            </p>
          )
        ) : (
          <DeckPicker
            decks={saved.decks}
            current={draft.myCards}
            onLoad={(d) => onDraft({ ...draft, myCards: d.cards })}
            onSave={saveDeck}
            onRename={(id, name) => onSaved(renameDeck(saved, id, name))}
            onDelete={(id) => onSaved({ ...saved, decks: saved.decks.filter((d) => d.id !== id) })}
            onReorder={(decks) => onSaved({ ...saved, decks })}
          />
        )}
      </section>

      {/* 重い任意の機能なので、対戦相手・ルール・手札の後ろに畳んで置く */}
      <section>
        <DeckAdvisor
          draft={draft}
          collection={collection}
          savedDecks={saved.decks}
          onUse={(cards) => onDraft({ ...draft, myCards: cards })}
          onOpenCollection={onOpenCollection}
          searchable={!drafting}
        />
      </section>

      {warnings.map((w) => <p className="note note-warn" key={w}>{w}</p>)}

      <div className="start-bar">
        <button type="button" className="btn btn-primary" disabled={problems.length > 0} onClick={onStart}>
          {problems.length > 0 ? '自分の手札を 5 枚入れてください' : '対戦を始める'}
        </button>
      </div>

      {target && (
        <CardEditor title={title} owner={target.kind === 'my' ? 0 : 1} typeMatters={typeMatters} onCommit={commit} onClose={() => setTarget(null)} />
      )}
    </main>
  );
}

/** NPC の可変プールのカードか(手札から外した時に候補へ戻すかどうかの判定) */
function isNpcVariable(npcId: number | null, card: CardDef): boolean {
  const npc = npcId === null ? undefined : npcById(npcId);
  return npc !== undefined && npcCards(npc).variable.some((c) => sameCard(toCardDef(c), card));
}
