import { useState } from 'react';
import type { SavedDeck } from '../core/presets';
import { formatSides, type CardDef } from '../core/types';

interface Props {
  decks: readonly SavedDeck[];
  current: readonly (CardDef | null)[];
  onLoad: (deck: SavedDeck) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}

export function DeckPicker({ decks, current, onLoad, onSave, onDelete }: Props) {
  const [name, setName] = useState('');
  const complete = current.every((c) => c !== null);

  return (
    <div className="decks">
      {decks.length > 0 && (
        <ul className="deck-list">
          {decks.map((d) => (
            <li key={d.id}>
              <button type="button" className="deck-load" onClick={() => onLoad(d)}>
                <span className="result-name">{d.name}</span>
                <span className="result-sides">{d.cards.map((c) => c.label ?? formatSides(c.sides)).join('、')}</span>
              </button>
              <button type="button" className="btn-quiet" onClick={() => onDelete(d.id)} aria-label={`${d.name} を削除`}>削除</button>
            </li>
          ))}
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
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="デッキ名" aria-label="デッキ名" maxLength={20} />
          <button type="submit" className="btn-quiet">今の手札を保存</button>
        </form>
      )}
    </div>
  );
}
