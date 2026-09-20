import { useMemo, useState } from 'react';
import { draftToSetup, parseAppState, type AppState } from './core/appState';
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

  const start = () => {
    const setup = draftToSetup(app.draft);
    if (setup) setApp({ ...app, phase: 'play', setup, events: [] });
  };

  return (
    <CardArtContext value={prefs.cardArt}>
      <header className="site-head">
        <h1>triadnavi</h1>
        <p className="tagline">トリプルトライアドの次の一手</p>
        {!playing && (
          <button type="button" className={`btn${collecting ? ' is-on' : ''}`} aria-pressed={collecting} onClick={() => setCollecting(!collecting)}>
            {ownedCount > 0 ? `手持ち ${ownedCount} 枚` : '手持ちを登録'}
          </button>
        )}
        <button type="button" className="btn-quiet" onClick={() => setHelp(true)}>保証できること</button>
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
          onRematch={(setup) => setApp((s) => ({ ...s, setup, events: [] }))}
          onNewMatch={() => setApp((s) => ({ ...s, phase: 'setup', setup: null, events: [] }))}
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
        <p>非公式のファンツールです。</p>
        <p>カードと NPC のデータ: FFXIV Collect、XIVAPI</p>
        <p>カードの絵はゲーム内の画像です。このサイトには置かず、有志のサービス XIVAPI から表示のたびに読み込んでいます(「カードの絵を表示」を外すと読み込みません)。</p>
        <p>FINAL FANTASY XIV © SQUARE ENIX</p>
      </footer>

      {help && <HelpModal onClose={() => setHelp(false)} />}
    </CardArtContext>
  );
}
