import { useMemo, useState, type MouseEvent } from 'react';
import { changeRules, draftToSetup, parseAppState, restartMatch, type AppState } from './core/appState';
import { parseCollection } from './core/collection';
import { parsePrefs } from './core/prefs';
import { parseSaved } from './core/presets';
import { ownedCards } from './data';
import { CollectionScreen } from './components/CollectionScreen';
import { HelpModal } from './components/HelpModal';
import { PlayScreen } from './components/PlayScreen';
import { SetupScreen } from './components/SetupScreen';
import { CardArtContext } from './hooks/useCardArt';
import { usePersisted } from './hooks/usePersisted';

export default function App() {
  const [app, setApp] = usePersisted<AppState>('triadnavi:state:v1', parseAppState);
  const [saved, setSaved] = usePersisted('triadnavi:saved:v1', parseSaved);
  const [collection, setCollection] = usePersisted('triadnavi:collection:v1', parseCollection);
  const [prefs, setPrefs] = usePersisted('triadnavi:prefs:v1', parsePrefs);
  const [help, setHelp] = useState(false);
  // 手持ちの画面は保存する状態(phase)には入れない。再読み込みしたら対戦前の画面に戻るだけでよい
  const [collecting, setCollecting] = useState(false);
  const playing = app.phase === 'play' && app.setup !== null;
  // 手持ちの画面の見出し(所持 N / 475 枚)と同じ数え方でないと食い違うので、ownedCards を通す
  const ownedCount = useMemo(() => ownedCards(collection).length, [collection]);

  // 対局の記録を閉じて対戦前の画面へ(設定の下書きは残る)
  const toSetup = () => setApp((s) => ({ ...s, phase: 'setup', setup: null, events: [] }));

  // ロゴ = 対戦前の画面へ。対局中なら「設定に戻る」と同じ
  const goTop = (e: MouseEvent<HTMLAnchorElement>) => {
    // 新しいタブで開く操作(Ctrl/⌘ + クリック、中クリック)はブラウザに任せる
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setCollecting(false);
    if (app.phase !== 'setup') toSetup();
    window.scrollTo(0, 0);
  };

  const start = () => {
    const setup = draftToSetup(app.draft);
    if (!setup) return;
    setApp({ ...app, phase: 'play', setup, events: [] });
    // 設定画面の途中までスクロールした位置のまま対局画面が出ないように
    window.scrollTo(0, 0);
  };

  return (
    <CardArtContext value={prefs.cardArt}>
      <header className="site-head">
        <h1><a href={import.meta.env.BASE_URL} className="site-logo" onClick={goTop}>triadnavi</a></h1>
        <p className="tagline">トリプルトライアドの次の一手</p>
        {!playing && (
          <button type="button" className={`btn${collecting ? ' is-on' : ''}`} aria-pressed={collecting} onClick={() => setCollecting(!collecting)}>
            {ownedCount > 0 ? `手持ち ${ownedCount} 枚` : '手持ちを登録'}
          </button>
        )}
        <button type="button" className="btn-tertiary" onClick={() => setHelp(true)}>保証できること</button>
      </header>

      {collecting && !playing ? (
        <CollectionScreen collection={collection} onChange={setCollection} onClose={() => setCollecting(false)} />
      ) : app.phase === 'play' && app.setup ? (
        <PlayScreen
          setup={app.setup}
          events={app.events}
          priorLevel={app.draft.priorLevel}
          saved={saved}
          onEvents={(events) => setApp((s) => ({ ...s, events }))}
          onRematch={(setup) => {
            setApp((s) => ({ ...s, setup, events: [] }));
            window.scrollTo(0, 0);
          }}
          onNewMatch={toSetup}
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
          onOpenCollection={() => setCollecting(true)}
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
