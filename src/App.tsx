import { useState } from 'react';
import { draftToSetup, parseAppState, type AppState } from './core/appState';
import { parseSaved } from './core/presets';
import { HelpModal } from './components/HelpModal';
import { PlayScreen } from './components/PlayScreen';
import { SetupScreen } from './components/SetupScreen';
import { usePersisted } from './hooks/usePersisted';

export default function App() {
  const [app, setApp] = usePersisted<AppState>('triadnavi:state:v1', parseAppState);
  const [saved, setSaved] = usePersisted('triadnavi:saved:v1', parseSaved);
  const [help, setHelp] = useState(false);

  const start = () => {
    const setup = draftToSetup(app.draft);
    if (setup) setApp({ ...app, phase: 'play', setup, events: [] });
  };

  return (
    <>
      <header className="site-head">
        <h1>triadnavi</h1>
        <p className="tagline">トリプルトライアドの次の一手</p>
        <button type="button" className="btn-quiet" onClick={() => setHelp(true)}>保証できること</button>
      </header>

      {app.phase === 'play' && app.setup ? (
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
        <SetupScreen draft={app.draft} saved={saved} onDraft={(draft) => setApp((s) => ({ ...s, draft }))} onSaved={setSaved} onStart={start} />
      )}

      <footer className="site-foot">
        <p>非公式のファンツールです。ゲームの画像は使っていません。</p>
        <p>カードと NPC のデータ: FFXIV Collect、XIVAPI</p>
        <p>FINAL FANTASY XIV © SQUARE ENIX</p>
      </footer>

      {help && <HelpModal onClose={() => setHelp(false)} />}
    </>
  );
}
