import { useState } from 'react';
import { DECK_NAME_MAX, type SavedDeck } from '../core/presets';
import { formatSides, type CardDef } from '../core/types';

interface Props {
  decks: readonly SavedDeck[];
  current: readonly (CardDef | null)[];
  onLoad: (deck: SavedDeck) => void;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function DeckPicker({ decks, current, onLoad, onSave, onRename, onDelete }: Props) {
  const [name, setName] = useState('');
  // 名前を変更中のデッキ。変更中の行だけ入力欄に差し替える
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const complete = current.every((c) => c !== null);

  return (
    <div className="decks">
      {decks.length > 0 && (
        <ul className="deck-list">
          {decks.map((d) =>
            editing?.id === d.id ? (
              <li key={d.id}>
                <form
                  className="deck-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRename(d.id, editing.name);
                    setEditing(null);
                  }}
                >
                  <input
                    value={editing.name}
                    onChange={(e) => setEditing({ id: d.id, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                    aria-label={`${d.name} の新しい名前`}
                    maxLength={DECK_NAME_MAX}
                    autoFocus
                  />
                  <button type="submit" className="btn btn-sm">保存</button>
                  <button type="button" className="btn-tertiary" onClick={() => setEditing(null)}>やめる</button>
                </form>
              </li>
            ) : (
              <li key={d.id}>
                <button type="button" className="deck-load" onClick={() => onLoad(d)}>
                  <span className="result-name">{d.name}</span>
                  <span className="result-sides">{d.cards.map((c) => c.label ?? formatSides(c.sides)).join('、')}</span>
                </button>
                <button type="button" className="btn-tertiary" onClick={() => setEditing({ id: d.id, name: d.name })} aria-label={`${d.name} の名前を変更`}>名前を変更</button>
                <button type="button" className="btn-danger btn-sm" onClick={() => onDelete(d.id)} aria-label={`${d.name} を削除`}>削除</button>
              </li>
            ),
          )}
        </ul>
      )}
      {complete && (
        <form
          className="deck-save"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name.trim() || `デッキ ${decks.length + 1}`);
            setName('');
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="デッキ名" aria-label="デッキ名" maxLength={DECK_NAME_MAX} />
          <button type="submit" className="btn btn-sm">今の手札を保存</button>
        </form>
      )}
    </div>
  );
}
