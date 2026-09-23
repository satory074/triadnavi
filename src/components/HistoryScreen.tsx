import { useState } from 'react';
import { MAX_HISTORY, entryOutcome, rematchCount, tally, type HistoryEntry, type MatchHistory } from '../core/history';
import { entryRuleIds, formatDateTime, historyJson, historyTitle, historyTsv, opponentLabel, resultText } from '../data/historyExport';
import { DeckStrip } from './DeckStrip';
import { ConfirmAction } from './ConfirmAction';
import { OutcomeBar } from './OutcomeBar';
import { RuleNames } from './RuleNames';

interface Props {
  history: MatchHistory;
  /** 今の対局の記録(「対局中」の印を付ける) */
  currentId: string | null;
  onRemove: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}

/** 一度に描く件数。上限まで溜まった時にカード 5 枚 × 200 件を一度に描かない */
const PAGE = 50;
/** この件数から書き出しを促す */
const WARN_AT = Math.floor(MAX_HISTORY * 0.9);

/**
 * 対戦記録の一覧。大会とオフィシャルトーナメントの対局が自動で入る(App.tsx の同期)。
 * 書き出しは JSON(保存データそのまま。手順を含む)と TSV(1 行 1 対戦。表計算ソフトに貼る用)
 */
export function HistoryScreen({ history, currentId, onRemove, onClear, onClose }: Props) {
  const [shown, setShown] = useState(PAGE);
  const [message, setMessage] = useState<string | null>(null);
  const entries = [...history.entries].reverse();
  const n = entries.length;
  const tallies = tally(history.entries);

  const download = () => {
    const blob = new Blob([historyJson(history.entries, Date.now())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `triadnavi-history-${formatDateTime(Date.now()).slice(0, 10).replaceAll('-', '')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(historyTsv(history.entries));
      setMessage('コピーしました。表計算ソフトに貼り付けてください');
    } catch {
      setMessage('コピーできませんでした');
    }
  };

  return (
    <main className="history">
      <div className="coll-head">
        <h2>対戦記録</h2>
        <span className="muted">{n} 件(上限 {MAX_HISTORY} 件。超えると古いものから消えます)</span>
        <button type="button" className="btn-tertiary" onClick={onClose}>戻る</button>
      </div>
      <p className="note">大会とオフィシャルトーナメントの対局を、このブラウザに自動で記録します(通常モードは記録しません。1 枚も置かなかった対局は残りません)。</p>
      {n >= WARN_AT && <p className="note note-warn">上限に近づいています。JSON を書き出して残してください。</p>}

      {tallies.length > 0 && (
        <section className="hist-tally">
          <h3>戦績</h3>
          {tallies.map((t) => {
            const title = historyTitle(t);
            return (
              <div className="hist-tally-row" key={`${t.mode}:${t.tournamentId}:${t.openRulesetId}`}>
                <span>{title}</span>
                <span className="hist-tally-num">{t.win} 勝 {t.draw} 分 {t.loss} 敗</span>
                <OutcomeBar win={t.win} draw={t.draw} loss={t.loss} label={`${title} の戦績`} />
              </div>
            );
          })}
        </section>
      )}

      {n === 0 ? (
        <p className="result-empty">まだ記録がありません。</p>
      ) : (
        <ul className="hist-list">
          {entries.slice(0, shown).map((e) => (
            <HistoryItem key={e.id} entry={e} current={e.id === currentId} onRemove={() => onRemove(e.id)} />
          ))}
        </ul>
      )}
      {n > shown && (
        <button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>さらに表示(残り {n - shown} 件)</button>
      )}

      <section className="coll-io">
        <h3>書き出す</h3>
        <p className="note">JSON は記録の全部(手順を含む)、TSV は 1 行 1 対戦の表(表計算ソフトに貼り付ける用)です。記録はこのブラウザにだけ保存されます。</p>
        <div className="coll-row">
          <button type="button" className="btn" disabled={n === 0} onClick={download}>JSON をダウンロード</button>
          <button type="button" className="btn-tertiary" disabled={n === 0} onClick={copy}>表計算向け(TSV)をコピー</button>
          <ConfirmAction className="btn-danger btn-sm" small label="全部消す" confirmLabel={`${n} 件を全て消す`} disabled={n === 0} onConfirm={onClear} />
        </div>
        {message && <p className="note note-warn" role="status">{message}</p>}
      </section>
    </main>
  );
}

function HistoryItem({ entry, current, onRemove }: { entry: HistoryEntry; current: boolean; onRemove: () => void }) {
  const first = entry.games[0];
  const outcome = entryOutcome(entry);
  const when = formatDateTime(entry.startedAt);
  const rematches = rematchCount(entry);
  const ruleIds = entryRuleIds(entry);
  return (
    <li className={`panel hist-entry${current ? ' is-current' : ''}`}>
      <div className="hist-head">
        <time dateTime={new Date(entry.startedAt).toISOString()}>{when}</time>
        <span className="chip chip-on">{historyTitle(entry)}</span>
        {current && <span className="muted">対局中</span>}
        <ConfirmAction className="btn-danger btn-sm" small label="削除" confirmLabel="この記録を削除" aria-label={`${when} の記録を削除`} onConfirm={onRemove} />
      </div>
      <p className="muted hist-meta">
        相手: {opponentLabel(entry)} / 先攻: {first.setup.first === 0 ? '自分' : '相手'} / {ruleIds.length > 0 ? <RuleNames ids={ruleIds} /> : '追加ルールなし'}
      </p>
      <DeckStrip cards={first.setup.myHand} className="hist-cards" />
      <p className={`hist-result${outcome ? ` is-${outcome}` : ''}`}>
        {resultText(entry)}
        {rematches > 0 && <span className="muted"> サドンデス {rematches} 回</span>}
      </p>
    </li>
  );
}
