import { useMemo, useState } from 'react';
import { matchupFromDraft, type SetupDraft } from '../core/appState';
import type { DeckCard } from '../core/collection';
import { matchupKey, type DeckContext } from '../core/deckEval';
import { scenarioSummary } from '../core/deckRank';
import { deckSearchProgress, prepareDeckSearch, topDecks } from '../core/deckSearch';
import { DRAFT_ROUNDS, DRAFT_SETS, draftRound, rankDraftSets } from '../core/draftPick';
import { sameCard } from '../core/presets';
import { progressPercent } from '../core/rank';
import { rulesFromIds } from '../core/rules';
import type { CardDef } from '../core/types';
import { preMatchRules, toDeckCards, withPrior } from '../data';
import { useDeckSearch, type DeckSearchRequest } from '../hooks/useDeckSearch';
import { CardEditor } from './CardEditor';
import { CardView } from './CardView';
import { DeckResult } from './DeckAdvisor';

interface Props {
  draft: SetupDraft;
  onDraft: (next: SetupDraft) => void;
}

/**
 * ドラフトの補助。ラウンドは自分の手札の埋まり具合から決まり(0〜1 枚 → 1、2〜3 枚 → 2、4 枚 → 3)、
 * 取ったセットのカードは myCards の空きに入る。提示されたセットの入力はこのコンポーネントの一時状態(再読み込みで消えるのは
 * そのラウンドの入力だけ)。ラウンドが変わると key で作り直して入力を空にする
 */
export function DraftPanel({ draft, onDraft }: Props) {
  const filled = draft.myCards.filter((c) => c !== null).length;
  const round = draftRound(filled);
  if (round >= DRAFT_ROUNDS.length) return null;
  return <DraftRound key={round} round={round} draft={draft} onDraft={onDraft} />;
}

type Sets = (CardDef | null)[][];

interface RoundProps {
  round: number;
  draft: SetupDraft;
  onDraft: (next: SetupDraft) => void;
}

function DraftRound({ round, draft, onDraft }: RoundProps) {
  const size = DRAFT_ROUNDS[round];
  const [sets, setSets] = useState<Sets>(() => Array.from({ length: DRAFT_SETS }, () => Array<CardDef | null>(size).fill(null)));
  const [target, setTarget] = useState<{ set: number; slot: number } | null>(null);
  const [compare, setCompare] = useState<{ key: string; context: DeckContext; request: DeckSearchRequest } | null>(null);
  const { search, running, stop } = useDeckSearch(compare?.request ?? null);

  const { matchup, fill } = useMemo(() => withPrior(matchupFromDraft(draft, preMatchRules(draft))), [draft]);
  const key = matchupKey(matchup);
  const complete = sets.every((s) => s.every((c) => c !== null));
  const ranked = useMemo(() => (complete ? rankDraftSets(sets.map((s) => toDeckCards(s as CardDef[])), matchup) : []), [complete, sets, matchup]);
  const best = ranked[0]?.index ?? -1;
  const picked = draft.myCards.filter((c): c is CardDef => c !== null);
  const last = round === DRAFT_ROUNDS.length - 1;
  const stale = compare !== null && compare.key !== key;

  const commit = (card: CardDef) => {
    if (!target) return;
    setSets((prev) => prev.map((s, i) => (i === target.set ? s.map((c, j) => (j === target.slot ? card : c)) : s)));
    // 次の空きへ進む(同じセットの次の枠 → 次のセット)
    const next = sets.flatMap((s, i) => s.map((c, j) => ({ set: i, slot: j, empty: c === null }))).filter((x) => x.empty && !(x.set === target.set && x.slot === target.slot));
    setTarget(next[0] ? { set: next[0].set, slot: next[0].slot } : null);
  };

  const take = (index: number) => {
    const myCards = draft.myCards.slice();
    for (const card of sets[index] as CardDef[]) {
      const slot = myCards.indexOf(null);
      if (slot < 0) break;
      myCards[slot] = card;
    }
    onDraft({ ...draft, myCards });
  };

  /** 最終ラウンド: 3 通りの完成デッキを、想定した相手に対して空の盤面から読み切って比べる */
  const startCompare = () => {
    const decks: DeckCard[][] = sets.map((s) => toDeckCards([...picked, ...(s as CardDef[])]));
    const p = prepareDeckSearch({ matchup, mode: 'evaluate', owned: [], decks, fill, refine: false });
    const runId = (compare?.request.runId ?? 0) + 1;
    setCompare({ key, context: p.context, request: { runId, context: p.context, start: p.search } });
  };

  const setIndexOf = (cards: readonly DeckCard[]) => sets.findIndex((s) => s.every((c, j) => c !== null && sameCard(c, cards[picked.length + j])));
  const progress = search ? deckSearchProgress(search) : null;
  const results = search && compare && !stale ? topDecks(search, DRAFT_SETS) : [];

  return (
    <div className="draft-panel">
      <p className="draft-head">
        <strong>ドラフト ラウンド {round + 1} / {DRAFT_ROUNDS.length}</strong>
        <span className="muted">提示された {DRAFT_SETS} つのセット({size} 枚ずつ)を入れると、おすすめのセットが出ます</span>
      </p>
      <div className="draft-sets">
        {sets.map((s, i) => (
          <div className={`draft-set${complete && i === best ? ' is-best' : ''}`} key={i}>
            <p className="draft-set-head">
              セット {i + 1}
              {complete && i === best && <span className="badge">おすすめ</span>}
            </p>
            <div className="draft-cards">
              {s.map((card, j) => (
                <CardView key={j} card={card} empty owner={0} size="sm" onClick={() => setTarget({ set: i, slot: j })} ariaLabel={card ? `セット ${i + 1} の ${j + 1} 枚目を変更` : `セット ${i + 1} の ${j + 1} 枚目を入力`} />
              ))}
            </div>
            {complete && <p className="draft-score muted">点 {ranked.find((r) => r.index === i)!.score.toFixed(2)}</p>}
            <button type="button" className={complete && i === best ? 'btn btn-primary btn-sm' : 'btn btn-sm'} disabled={!complete} onClick={() => take(i)}>
              このセットを取った
            </button>
          </div>
        ))}
      </div>
      <p className="note">点は、想定した相手のカードに対する静的な強さ(セイム/プラスがあれば数字の噛み合いも)の合計です。読み切りはしていません。</p>

      {last && complete && (
        <div className="draft-compare">
          <button type="button" className="btn" disabled={running} onClick={startCompare}>3 通りのデッキを読み切って比べる</button>
          {compare && !stale && search && progress && (
            <div className="advisor-result">
              <p className="muted">{scenarioSummary(matchup, compare.context.set, false)}</p>
              {running ? (
                <div className="search-progress">
                  <div className="search-progress-bar">
                    <progress value={progress.ratio} aria-label="比較の進み具合" />
                    <strong className="search-progress-pct">{progressPercent(progress.ratio)}%</strong>
                    <button type="button" className="btn btn-sm" onClick={stop}>止める</button>
                  </div>
                </div>
              ) : (
                <p className="note" role="status">良い順です。上のセットの「このセットを取った」で確定してください。</p>
              )}
              {results.map((e, i) => {
                const idx = setIndexOf(e.cards);
                return <DeckResult key={e.key} search={search} evaluation={e} context={compare.context} title={idx >= 0 ? `セット ${idx + 1}` : ''} replaces={false} best={i === 0} />;
              })}
            </div>
          )}
          {stale && <p className="note note-warn">ルールか相手の想定が変わりました。もう一度比べてください。</p>}
        </div>
      )}

      {target && (
        <CardEditor title={`セット ${target.set + 1} の ${target.slot + 1} 枚目`} owner={0} typeMatters={rulesFromIds(draft.ruleIds).typeShift !== 'none'} onCommit={commit} onClose={() => setTarget(null)} />
      )}
    </div>
  );
}
