import { useEffect, useMemo, useState } from 'react';
import { matchupFromDraft, type SetupDraft } from '../core/appState';
import type { Collection, DeckCard } from '../core/collection';
import { matchupKey, matchupProblems, poolShort, type DeckContext, type DeckEvalKind } from '../core/deckEval';
import { deckKey } from '../core/deckPool';
import { DECK_KIND_LABEL, deckKindNote, deckLines, deckSummary, matchupCautions, mineVerdict, scenarioSummary, seedCheckText, stopReasonText, variantRows } from '../core/deckRank';
import {
  checkSeed, compareScores, deckScore, deckSearchProgress, isComplete, prepareDeckSearch, seedUsable, topDecks,
  type DeckEval, type DeckSearch, type SearchPhase, type SeedCheck,
} from '../core/deckSearch';
import type { SavedDeck } from '../core/presets';
import { percent, progressPercent } from '../core/rank';
import { formatSides, type CardDef } from '../core/types';
import { ALL_DECK_CARDS, npcById, ownedCards, preMatchRules, toDeckCard, toDeckCards, withPrior } from '../data';
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

/**
 * 登録済みのデッキ(今の手札と保存デッキ)。探索の出発点の先頭に入れて最初に評価し、結果の上に一覧で見せる
 * (最良のデッキがすでに組んであるなら、ゲーム内でデッキを編集しなくて済む)。同じ構成(同じ key)は 1 つにまとめる。
 * 名前は core に持たせず、渡したカードの配列から deckKey を引いて search.evals を見る
 */
interface MineEntry {
  names: string[];
  cards: DeckCard[];
  /** 出発点に使えない(手持ちに無いカードを含む、制限に合わない)時は null */
  key: string | null;
  check: SeedCheck;
}

interface Run {
  mode: Mode;
  matchupKey: string;
  kind: DeckEvalKind;
  context: DeckContext;
  mine: MineEntry[];
  request: DeckSearchRequest;
}

const PHASE_TEXT: Record<SearchPhase, string> = {
  seeds: '登録済みのデッキと出発点のデッキを評価しています',
  climb: '1 枚入れ替えたデッキを調べています',
  refine: '上位のデッキを、想定を増やして測り直しています',
  certify: '相手がどのカードを持っていても成り立つか(保証)を確かめています',
  done: '完了',
};

const HAND_NAME = '今の手札';

/** 登録済みのデッキの名前の並び。保存デッキは「」で囲み、今の手札はそのまま */
const quoteNames = (names: readonly string[]) => names.map((n) => (n === HAND_NAME ? n : `「${n}」`)).join(' / ');

function groupMine(decks: readonly { name: string; cards: DeckCard[] }[], ownedIds: ReadonlySet<number>, ordered: boolean): MineEntry[] {
  const out: MineEntry[] = [];
  for (const { name, cards } of decks) {
    const check = checkSeed(cards, ownedIds);
    const key = seedUsable(check) ? deckKey(cards, ordered) : null;
    const same = key === null ? undefined : out.find((e) => e.key === key);
    if (same) same.names.push(name);
    else out.push({ names: [name], cards, key, check });
  }
  return out;
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
    const pool = mode === 'all' ? ALL_DECK_CARDS : owned;
    const ownedIds = new Set(pool.map((c) => c.id));
    const hand = myDeck ? [{ name: HAND_NAME, cards: myDeck }] : [];
    const named = mode === 'evaluate' ? hand : [...hand, ...savedDecks.map((d) => ({ name: d.name, cards: d.cards }))];
    // 同梱データに無い手入力のカードは、評価するだけなので仮の ID を振る(toDeckCards)
    const decks = named.map((d) => ({ name: d.name, cards: toDeckCards(d.cards, ownedIds) }));
    const p = prepareDeckSearch({ matchup, mode: mode === 'evaluate' ? 'evaluate' : 'search', owned: pool, decks: decks.map((d) => d.cards), fill });
    const mine = mode === 'evaluate' ? [] : groupMine(decks, ownedIds, p.search.ordered);
    const runId = (run?.request.runId ?? 0) + 1;
    setRun({ mode, matchupKey: key, kind: p.kind, context: p.context, mine, request: { runId, context: p.context, start: p.search } });
  };

  const progress = search ? deckSearchProgress(search) : null;
  const top = search && run && !stale ? topDecks(search) : [];
  const handKey = run?.mine.find((m) => m.names.includes(HAND_NAME))?.key ?? null;
  // 計算中は上位が登録済みのデッキで埋まっている(最初に評価するので)。「同じ」は結果が出揃ってから言う
  const sameAs = (e: DeckEval) => (running || !run ? [] : run.mine.filter((m) => m.key === e.key).flatMap((m) => m.names));

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
              ? '相手が最善を尽くしても勝ちが確定する状況が、最も多いデッキを探します。今の手札と保存したデッキを最初に評価するので、すでに組んであるデッキが最良ならそのまま使えます。探索には数十秒から数分かかります。途中で止めても、その時点の最良が残ります。'
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

          {run.mine.length > 0 && <MineList mine={run.mine} search={search} running={running} complete={progress.complete} top={top} />}

          {top.map((e, i) => {
            const names = sameAs(e);
            const base = run.mode === 'evaluate' ? '今のデッキ' : i === 0 ? '見つかった中で最良' : `候補 ${i + 1}`;
            return (
              <DeckResult
                key={e.key}
                search={search}
                evaluation={e}
                context={run.context}
                title={names.length > 0 ? `${base}(${quoteNames(names)}と同じ)` : base}
                best={run.mode !== 'evaluate' && i === 0}
                onUse={run.mode === 'evaluate' || e.key === handKey ? undefined : () => onUse(e.cards.map((c) => ({ sides: c.sides, type: c.type, label: c.label })))}
                replaces={draft.myCards.some((c) => c !== null)}
              />
            );
          })}

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

interface MineProps {
  mine: readonly MineEntry[];
  search: DeckSearch;
  running: boolean;
  /** 探索が最後まで終わった(止めたのではない) */
  complete: boolean;
  top: readonly DeckEval[];
}

/** 登録済みのデッキの一覧。1 行 1 デッキで、評価が済んだものから帯と要約が付く */
function MineList({ mine, search, running, complete, top }: MineProps) {
  const evalOf = (m: MineEntry) => (m.key === null ? undefined : search.evals[m.key]);
  const done = (m: MineEntry) => {
    const e = evalOf(m);
    return e !== undefined && isComplete(search, e);
  };
  const usable = mine.filter((m) => m.key !== null);
  // 結論は、計算が終わって(または止めて)、使える登録済みのデッキが全て評価済みの時だけ
  const settled = !running && top.length > 0 && usable.length > 0 && usable.every(done);
  let verdict: { text: string; same: boolean } | null = null;
  if (settled) {
    const same = usable.find((m) => m.key === top[0].key);
    const best = same ?? [...usable].sort((a, b) => compareScores(deckScore(search, evalOf(b)!), deckScore(search, evalOf(a)!)))[0];
    verdict = { text: mineVerdict(quoteNames(best.names), same !== undefined, complete), same: same !== undefined };
  }
  return (
    <div className="advisor-mine">
      <p className="advisor-mine-head">
        <strong>登録済みのデッキ</strong>
        <span className="muted">最初に評価します</span>
      </p>
      {verdict && <p className={`advisor-mine-verdict cls ${verdict.same ? 'cls-win' : 'cls-plain'}`} role="status">{verdict.text}</p>}
      <ul>
        {mine.map((m, i) => {
          const e = evalOf(m);
          return (
            <li key={i}>
              <span className="advisor-mine-name">
                <strong>{m.names.join(' / ')}</strong>
                <span className="result-sides">{m.cards.map((c) => c.label ?? formatSides(c.sides)).join('、')}</span>
              </span>
              {m.key === null ? (
                <span className="advisor-mine-check">{seedCheckText(m.check)}</span>
              ) : done(m) ? (
                <>
                  <OutcomeBar win={deckScore(search, e!).win} draw={deckScore(search, e!).drawOrBetter - deckScore(search, e!).win} loss={1 - deckScore(search, e!).drawOrBetter} label={`${m.names.join(' / ')} の勝ち・引き分け・負けの割合`} />
                  <span className="advisor-mine-sum">{deckSummary(search, e!)}</span>
                </>
              ) : (
                <span className="advisor-mine-sum muted">{running ? '計算中…' : '評価していません(途中で止めました)'}</span>
              )}
            </li>
          );
        })}
      </ul>
      {search.refineScenarios !== null && <p className="note">上位に入らなかったデッキは測り直していないので、通り数が上位と違います。</p>}
    </div>
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
  /** 最良のデッキ(金の枠) */
  best?: boolean;
}

/** デッキ 1 つの結果(手札、勝ち/分/負の帯、説明、ルーレットの内訳)。ドラフトの比較(DraftPanel)でも使う */
export function DeckResult({ search, evaluation, context, title, onUse, replaces, best = false }: ResultProps) {
  const rows = variantRows(search, evaluation, context.set, context.refineSet);
  const score = deckScore(search, evaluation);
  return (
    <div className={best ? 'advisor-deck is-best' : 'advisor-deck'}>
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
