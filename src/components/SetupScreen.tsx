import { useState } from 'react';
import {
  applyNpc, clearNpc, clearOppSlot, revealPoolCard, setupProblems, setupWarnings, toggleRule, type SetupDraft,
} from '../core/appState';
import { DECK_PROBLEM_TEXT, type Collection } from '../core/collection';
import type { SavedData, SavedDeck } from '../core/presets';
import { sameCard } from '../core/presets';
import { rulesFromIds } from '../core/rules';
import type { CardDef } from '../core/types';
import { handProblems, npcById, npcCards, toCardDef, type NpcInfo } from '../data';
import { CardEditor } from './CardEditor';
import { CardView } from './CardView';
import { DeckAdvisor } from './DeckAdvisor';
import { DeckPicker } from './DeckPicker';
import { NpcPicker } from './NpcPicker';
import { OpponentPanel } from './OpponentPanel';
import { RuleChips } from './RuleChips';

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

export function SetupScreen({ draft, saved, collection, onDraft, onSaved, onStart, onOpenCollection }: Props) {
  const [target, setTarget] = useState<Target | null>(null);
  const rules = rulesFromIds(draft.ruleIds);
  const typeMatters = rules.typeShift !== 'none';
  const problems = setupProblems(draft);
  const warnings = setupWarnings(draft);

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
      const oppCards = draft.oppCards.slice();
      oppCards[target.slot] = card;
      // 候補にあるカードを手で入れた場合は、候補から外す
      onDraft({ ...draft, oppCards, oppPool: draft.oppPool.filter((c) => !sameCard(c, card)) });
      setTarget(null);
    } else {
      if (!draft.oppPool.some((c) => sameCard(c, card))) onDraft({ ...draft, oppPool: [...draft.oppPool, card].slice(0, 20) });
    }
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
        <h2>対戦相手</h2>
        <NpcPicker npcId={draft.npcId} onPick={pickNpc} onClear={() => onDraft(clearNpc(draft))} />
      </section>

      <section>
        <h2>この対戦のルール</h2>
        <RuleChips ruleIds={draft.ruleIds} onToggle={(id) => onDraft({ ...draft, ruleIds: toggleRule(draft.ruleIds, id) })} />
        <p className="note">ルーレット、ランダムハンド、スワップ、ドラフトは、対戦が始まってから実際に決まったルールと手札を入れてください。</p>
        {rules.fallenAce && (rules.same || rules.plus) && (
          <label className="check">
            <input type="checkbox" checked={draft.fallenAceInCombo} onChange={(e) => onDraft({ ...draft, fallenAceInCombo: e.target.checked })} />
            コンボの連鎖中もエースキラーを有効にする(実機での検証例が無い挙動です。食い違ったら外してください)
          </label>
        )}
      </section>

      <section>
        <h2>自分の手札</h2>
        <div className="hand-row">
          {draft.myCards.map((card, i) => (
            <div className="slot" key={i}>
              <CardView card={card} empty owner={0} onClick={() => setTarget({ kind: 'my', slot: i })} ariaLabel={`自分の ${i + 1} 枚目を入力`} />
              <span className="slot-action">{card ? '変更' : '入力'}</span>
            </div>
          ))}
        </div>
        {handProblems(draft.myCards).map((p) => (
          <p className="note note-warn" key={p}>{DECK_PROBLEM_TEXT[p]}。ゲーム内ではこのデッキを組めません。</p>
        ))}
        {rules.pick === 'order' && <p className="note">オーダーでは左から順に出すことになります。デッキの並び順どおりに入れてください。</p>}
        <DeckPicker
          decks={saved.decks}
          current={draft.myCards}
          onLoad={(d) => onDraft({ ...draft, myCards: d.cards })}
          onSave={saveDeck}
          onDelete={(id) => onSaved({ ...saved, decks: saved.decks.filter((d) => d.id !== id) })}
        />
        <DeckAdvisor
          draft={draft}
          collection={collection}
          savedDecks={saved.decks}
          onUse={(cards) => onDraft({ ...draft, myCards: cards })}
          onOpenCollection={onOpenCollection}
        />
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
        <h2>先攻</h2>
        <div className="segmented segmented-big" role="group" aria-label="先攻">
          <button type="button" className={draft.first === 0 ? 'seg-on seg-blue' : ''} aria-pressed={draft.first === 0} onClick={() => onDraft({ ...draft, first: 0 })}>自分</button>
          <button type="button" className={draft.first === 1 ? 'seg-on seg-red' : ''} aria-pressed={draft.first === 1} onClick={() => onDraft({ ...draft, first: 1 })}>相手</button>
        </div>
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
