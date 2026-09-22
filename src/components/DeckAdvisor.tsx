import { useEffect, useMemo, useState } from 'react';
import { matchupFromDraft, type SetupDraft } from '../core/appState';
import type { Collection, DeckCard } from '../core/collection';
import { matchupKey, matchupProblems, poolShort, type DeckContext, type DeckEvalKind } from '../core/deckEval';
import { DECK_KIND_LABEL, deckKindNote, deckLines, matchupCautions, scenarioSummary, stopReasonText, variantRows } from '../core/deckRank';
import { deckScore, deckSearchProgress, prepareDeckSearch, topDecks, type DeckEval, type DeckSearch, type SearchPhase } from '../core/deckSearch';
import type { SavedDeck } from '../core/presets';
import { percent, progressPercent } from '../core/rank';
import type { CardDef } from '../core/types';
import { ALL_DECK_CARDS, npcById, ownedCards, preMatchRules, resolveDeck, toDeckCard, withPrior } from '../data';
import { useDeckSearch, type DeckSearchRequest } from '../hooks/useDeckSearch';
import { CardView } from './CardView';
import { ConfirmAction } from './ConfirmAction';
import { OutcomeBar } from './OutcomeBar';

interface Props {
  draft: SetupDraft;
  collection: Collection;
  savedDecks: readonly SavedDeck[];
  onUse: (cards: CardDef[]) => void;
  onOpenCollection: () => void;
  /** false なら「今のデッキを評価」だけ(ドラフトではデッキを探さない) */
  searchable?: boolean;
}

type Mode = 'evaluate' | 'owned' | 'all';

interface Run {
  mode: Mode;
  matchupKey: string;
  kind: DeckEvalKind;
  context: DeckContext;
  request: DeckSearchRequest;
}

const PHASE_TEXT: Record<SearchPhase, string> = {
  seeds: '出発点のデッキを評価しています',
  climb: '1 枚入れ替えたデッキを調べています',
  refine: '上位のデッキを、想定を増やして測り直しています',
  certify: '相手がどのカードを持っていても成り立つか(保証)を確かめています',
  done: '完了',
};

/** 同梱データに無い手入力のカードは、評価するだけなので仮の ID を振る */
function asDeckCards(cards: readonly CardDef[]): DeckCard[] {
  const resolved = resolveDeck(cards);
  return resolved ? resolved.map(toDeckCard) : cards.map((c, i) => ({ ...c, id: -(i + 1), stars: 0 }));
}


/**
 * 今のデッキの評価と、手持ちからのデッキの提案。探索は数分かかることがあるので、背景クリックで閉じてしまうモーダルではなく、
 * 対戦前の画面にそのまま置く。対戦条件(相手・ルール)を変えたら結果は古くなるので、計算を止めて出し直してもらう。
 */
export function DeckAdvisor({ draft, collection, savedDecks, onUse, onOpenCollection, searchable = true }: Props) {
  const [run, setRun] = useState<Run | null>(null);
  // 畳んだままにできるが、探索中は開いたままにする(閉じると進み具合が見えなくなる)
  const [open, setOpen] = useState(false);
  const { search, running, error, stop } = useDeckSearch(run?.request ?? null);

  const npc = draft.npcId === null ? undefined : npcById(draft.npcId);
  const { matchup, fill } = useMemo(() => withPrior(matchupFromDraft(draft, preMatchRules(draft))), [draft]);
  const key = matchupKey(matchup);
  const blocked = matchupProblems(matchup).length > 0;
  const myDeck = draft.myCards.every((c) => c !== null) ? (draft.myCards as CardDef[]) : null;
  const owned = useMemo(() => ownedCards(collection).map(toDeckCard), [collection]);
  const stale = run !== null && run.matchupKey !== key;

  useEffect(() => {
    if (stale) stop();
  }, [stale, stop]);

  const start = (mode: Mode) => {
    const decks = mode === 'evaluate' ? [asDeckCards(myDeck!)] : [...(myDeck ? [myDeck] : []), ...savedDecks.map((d) => d.cards)].map(asDeckCards);
    const p = prepareDeckSearch({ matchup, mode: mode === 'evaluate' ? 'evaluate' : 'search', owned: mode === 'all' ? ALL_DECK_CARDS : owned, decks, fill });
    const runId = (run?.request.runId ?? 0) + 1;
    setRun({ mode, matchupKey: key, kind: p.kind, context: p.context, request: { runId, context: p.context, start: p.search } });
  };

  const progress = search ? deckSearchProgress(search) : null;
  const top = search && run && !stale ? topDecks(search) : [];

  return (
    <details className="advisor" open={open || running} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><h3>デッキの評価と提案</h3></summary>
      {blocked ? (
        <p className="note">対戦相手の NPC を選ぶか、相手のカード(または候補)を入れると、デッキを評価できます。</p>
      ) : (
        <>
          <div className="advisor-actions">
            <button type="button" className="btn" disabled={running || !myDeck} onClick={() => start('evaluate')}>今のデッキを評価</button>
            {searchable && (owned.length >= 5 ? (
              <button type="button" className="btn" disabled={running} onClick={() => start('owned')}>手持ち {owned.length} 枚から探す</button>
            ) : (
              <button type="button" className="btn" onClick={onOpenCollection}>手持ちを登録する</button>
            ))}
            {searchable && <button type="button" className="btn-tertiary" disabled={running} onClick={() => start('all')}>全カードを持っている前提で探す</button>}
          </div>
          <p className="note">
            {searchable
              ? '相手が最善を尽くしても勝ちが確定する状況が、最も多いデッキを探します。探索には数十秒から数分かかります。途中で止めても、その時点の最良が残ります。'
              : 'ドラフトで組んだデッキを、想定した相手に対して空の盤面から読み切ります。'}
          </p>
        </>
      )}

      {stale && <p className="note note-warn">対戦相手かルールが変わりました。もう一度評価してください。</p>}
      {error && <p className="note note-warn">計算中にエラーが起きました: {error}</p>}

      {run && !stale && search && progress && (
        <div className="advisor-result">
          <div className="analysis-head">
            <span className={`kind kind-${run.kind === 'exact' ? 'exact' : 'estimate'}`}>{DECK_KIND_LABEL[run.kind]}</span>
            <span className="muted">{scenarioSummary(matchup, run.context.set, run.context.refineSet !== null)}</span>
          </div>
          {running ? (
            <div className="search-progress">
              <div className="search-progress-bar">
                <progress value={progress.ratio} aria-label="探索の進み具合" />
                <strong className="search-progress-pct">{progressPercent(progress.ratio)}%</strong>
                <button type="button" className="btn btn-sm" onClick={stop}>止める</button>
              </div>
              <p className="progress" role="status">
                {PHASE_TEXT[progress.phase]}… 評価したデッキ {progress.decksDone}
                {progress.decksPruned > 0 && `(ほかに ${progress.decksPruned} 個を途中で打ち切り)`}
              </p>
              {run.mode !== 'evaluate' && (
                <p className="note">
                  % は、入れ替えたデッキを上限の {search.options.maxDecks} 個まで調べる場合の目安です。全ての状況で勝てるデッキが見つかった時や、入れ替えても良くならなくなった時は、途中で先へ進みます。
                </p>
              )}
            </div>
          ) : top.length === 0 && run.mode !== 'evaluate' ? (
            <p className="note note-warn" role="status">手持ちからデッキを組めませんでした。★4 以上ばかりの時は、★3 以下のカードも登録してください。</p>
          ) : (
            <p className="note" role="status">
              {progress.complete ? stopReasonText(search.stopReason) : `途中で止めました(進み具合 ${progressPercent(progress.ratio)}% の時点)。ここまでに見つかった中で最良のデッキです。`}
              {run.mode !== 'evaluate' && ` 調べたデッキ: ${progress.decksDone + progress.decksPruned}`}
            </p>
          )}

          {top.map((e, i) => (
            <DeckResult
              key={e.key}
              search={search}
              evaluation={e}
              context={run.context}
              title={run.mode === 'evaluate' ? '今のデッキ' : i === 0 ? '見つかった中で最良' : `候補 ${i + 1}`}
              onUse={run.mode === 'evaluate' ? undefined : () => onUse(e.cards.map((c) => ({ sides: c.sides, type: c.type, label: c.label })))}
              replaces={draft.myCards.some((c) => c !== null)}
            />
          ))}

          <details className="fineprint">
            <summary>前提と注意</summary>
            <p className="note">{deckKindNote(run.kind, poolShort(matchup) ? matchup.oppPrior : undefined)}</p>
            {matchupCautions(matchup, npc?.usesRegional ?? false, npc ? 'npc' : 'player').map((t) => (
              <p className="note" key={t}>{t}</p>
            ))}
          </details>
        </div>
      )}
    </details>
  );
}

interface ResultProps {
  search: DeckSearch;
  evaluation: DeckEval;
  context: DeckContext;
  title: string;
  onUse?: () => void;
  /** 今の手札が入っている(使うと上書きされる)*/
  replaces: boolean;
}

/** デッキ 1 つの結果(手札、勝ち/分/負の帯、説明、ルーレットの内訳)。ドラフトの比較(DraftPanel)でも使う */
export function DeckResult({ search, evaluation, context, title, onUse, replaces }: ResultProps) {
  const rows = variantRows(search, evaluation, context.set, context.refineSet);
  const score = deckScore(search, evaluation);
  return (
    <div className="advisor-deck">
      <div className="advisor-deck-head">
        <strong>{title}</strong>
        {search.ordered && <span className="muted">左から順に出す並びです</span>}
        {onUse && (replaces ? (
          <ConfirmAction className="btn btn-sm" small label="このデッキを使う" confirmLabel="今の手札と置き換える" onConfirm={onUse} />
        ) : (
          <button type="button" className="btn btn-sm" onClick={onUse}>このデッキを使う</button>
        ))}
      </div>
      <div className="hand-row">
        {evaluation.cards.map((c, i) => (
          <div className="slot" key={i}>
            <CardView card={c} owner={0} size="sm" showName={false} />
            <span className="pool-name">{c.label ?? ''}{c.stars > 0 && <span className="coll-stars"> ★{c.stars}</span>}</span>
          </div>
        ))}
      </div>
      <OutcomeBar win={score.win} draw={score.drawOrBetter - score.win} loss={1 - score.drawOrBetter} />
      <ul className="advisor-lines">
        {deckLines(search, evaluation).map((l) => (
          <li key={l.text} className={`cls cls-${l.tone}`}>{l.text}</li>
        ))}
      </ul>
      {rows.length > 0 && (
        <table className="advisor-table">
          <thead>
            <tr><th>ルーレットで加わるルール</th><th>出る割合</th><th>勝ち確定</th><th>引き分け以上</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}><td>{r.label}</td><td>{percent(r.share)}</td><td>{percent(r.win)}</td><td>{percent(r.drawOrBetter)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
