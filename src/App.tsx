import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { changeRules, draftToSetup, handPriorOf, parseAppState, restartMatch, setEvents, toTop, type AppState } from './core/appState';
import { parseCollection } from './core/collection';
import { EMPTY_HISTORY, parseHistory, removeEntry, syncGame, type HistoryGame } from './core/history';
import { replay } from './core/match';
import { parsePrefs } from './core/prefs';
import { parseSaved } from './core/presets';
import { matchTitle, ownedCards } from './data';
import { CollectionScreen } from './components/CollectionScreen';
import { HelpModal } from './components/HelpModal';
import { HistoryScreen } from './components/HistoryScreen';
import { PlayScreen } from './components/PlayScreen';
import { SetupScreen } from './components/SetupScreen';
import { CardArtContext } from './hooks/useCardArt';
import { usePersisted } from './hooks/usePersisted';

/** 対戦記録の id。core は乱数を読まないので UI 側で作り、状態の更新関数の外で呼ぶ */
const newHistoryId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export default function App() {
  // トップは対局画面。開いた時に対局中でなければ、下書きから新しい対局を始める(手札が揃っていなければ設定画面)
  const [app, setApp] = usePersisted<AppState>('triadnavi:state:v1', (raw) => toTop(parseAppState(raw)));
  const [saved, setSaved] = usePersisted('triadnavi:saved:v1', parseSaved);
  const [collection, setCollection] = usePersisted('triadnavi:collection:v1', parseCollection);
  const [prefs, setPrefs] = usePersisted('triadnavi:prefs:v1', parsePrefs);
  const [history, setHistory] = usePersisted('triadnavi:history:v1', parseHistory);
  const [help, setHelp] = useState(false);
  // 手持ちと対戦記録の画面は保存する状態(phase)には入れない。再読み込みしたらトップに戻るだけでよい
  const [screen, setScreen] = useState<'collection' | 'history' | null>(null);
  // 手持ちの画面の見出し(所持 N / 475 枚)と同じ数え方でないと食い違うので、ownedCards を通す
  const ownedCount = useMemo(() => ownedCards(collection).length, [collection]);

  // 対局の記録を閉じて設定画面へ(設定の下書きは残る)。対局中の設定と下書きを食い違わせないため、記録は残さない
  const toSetup = () => setApp((s) => ({ ...s, phase: 'setup', setup: null, events: [], historyId: null }));

  // ロゴ = トップ(対局画面)へ。対局中なら記録はそのまま、設定画面からなら下書きで新しい対局を始める
  const goTop = (e: MouseEvent<HTMLAnchorElement>) => {
    // 新しいタブで開く操作(Ctrl/⌘ + クリック、中クリック)はブラウザに任せる
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setScreen(null);
    setApp(toTop);
    window.scrollTo(0, 0);
  };

  const start = () => {
    const setup = draftToSetup(app.draft);
    if (!setup) return;
    setApp({ ...app, phase: 'play', setup, events: [], historyId: null });
    // 設定画面の途中までスクロールした位置のまま対局画面が出ないように
    window.scrollTo(0, 0);
  };

  // 対戦記録への反映はここだけ。記録する対局(historyId が付いている)の setup / events が変わるたびに、その対局の分を書き直す。
  // syncGame は同じ入力なら同じ結果なので、StrictMode の 2 回実行でも再読み込み直後でも増えない。
  // 依存は draft 全体ではなく大会の 3 項目だけ(設定画面で下書きを編集しても走らないように)
  const { historyId, setup, events } = app;
  const { mode, tournamentId, openRulesetId } = app.draft;
  useEffect(() => {
    if (!historyId || !setup || mode === 'free') return;
    const view = replay(setup, events);
    const game: HistoryGame = { setup, events: events.slice(0, view.applied), outcome: view.outcome, score: view.score };
    const now = Date.now();
    setHistory((h) => syncGame(h, historyId, { mode, tournamentId, openRulesetId }, game, now));
  }, [historyId, setup, events, mode, tournamentId, openRulesetId, setHistory]);

  // 記録を消したら今の対局の id も外す。外さないと次の 1 手で丸ごと復活する(同期は差分ではなく対局の全体を書くため)
  const removeRecord = (id: string) => {
    setHistory((h) => removeEntry(h, id));
    setApp((s) => (s.historyId === id ? { ...s, historyId: null } : s));
  };
  const clearRecords = () => {
    setHistory(EMPTY_HISTORY);
    setApp((s) => (s.historyId === null ? s : { ...s, historyId: null }));
  };

  return (
    <CardArtContext value={prefs.cardArt}>
      <header className="site-head">
        <h1><a href={import.meta.env.BASE_URL} className="site-logo" onClick={goTop}>triadnavi</a></h1>
        <p className="tagline">トリプルトライアドの次の一手</p>
        <div className="site-actions">
          <button type="button" className={`btn${screen === 'collection' ? ' is-on' : ''}`} aria-pressed={screen === 'collection'} onClick={() => setScreen(screen === 'collection' ? null : 'collection')}>
            {ownedCount > 0 ? `手持ち ${ownedCount} 枚` : '手持ちを登録'}
          </button>
          <button type="button" className={`btn${screen === 'history' ? ' is-on' : ''}`} aria-pressed={screen === 'history'} onClick={() => setScreen(screen === 'history' ? null : 'history')}>
            {history.entries.length > 0 ? `対戦記録 ${history.entries.length} 件` : '対戦記録'}
          </button>
          <button type="button" className="btn-tertiary" onClick={() => setHelp(true)}>保証できること</button>
        </div>
      </header>

      {/* 対局中に開いても対局の記録は残る(PlayScreen は外れるので、戻った時に計算をやり直す) */}
      {screen === 'collection' ? (
        <CollectionScreen collection={collection} onChange={setCollection} onClose={() => setScreen(null)} />
      ) : screen === 'history' ? (
        <HistoryScreen history={history} currentId={app.historyId} onRemove={removeRecord} onClear={clearRecords} onClose={() => setScreen(null)} />
      ) : app.phase === 'play' && app.setup ? (
        <PlayScreen
          setup={app.setup}
          events={app.events}
          prior={handPriorOf(app.draft)}
          title={matchTitle(app.draft)}
          saved={saved}
          onEvents={(events) => {
            const id = newHistoryId();
            setApp((s) => setEvents(s, events, id));
          }}
          onRematch={(setup) => {
            setApp((s) => ({ ...s, setup, events: [] }));
            window.scrollTo(0, 0);
          }}
          onSetup={toSetup}
          // 下書きにも書いておくと、「はじめから」の後も直前に選んだ先攻のまま始まる
          onFirst={(first) => setApp((s) => ({ ...s, draft: { ...s.draft, first }, setup: s.setup && { ...s.setup, first } }))}
          onRestart={() => setApp(restartMatch)}
          onRules={(ruleIds, fallenAceInCombo) => setApp((s) => changeRules(s, ruleIds, fallenAceInCombo))}
          onSaved={setSaved}
        />
      ) : (
        <SetupScreen
          draft={app.draft}
          saved={saved}
          collection={collection}
          onDraft={(draft) => setApp((s) => ({ ...s, draft }))}
          onSaved={setSaved}
          onStart={start}
          onOpenCollection={() => setScreen('collection')}
        />
      )}

      <footer className="site-foot">
        <label className="check">
          <input type="checkbox" checked={prefs.cardArt} onChange={(e) => setPrefs({ ...prefs, cardArt: e.target.checked })} />
          カードの絵を表示
        </label>
        <p>非公式のファンツールです。カードと NPC のデータ: FFXIV Collect、XIVAPI。FINAL FANTASY XIV © SQUARE ENIX</p>
        <details>
          <summary>カードの絵について</summary>
          <p>カードの絵はゲーム内の画像です。このサイトには置かず、有志のサービス XIVAPI から表示のたびに読み込んでいます(「カードの絵を表示」を外すと読み込みません)。</p>
        </details>
      </footer>

      {help && <HelpModal onClose={() => setHelp(false)} />}
    </CardArtContext>
  );
}
