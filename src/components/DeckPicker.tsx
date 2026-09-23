import { useState } from 'react';
import { DECK_NAME_MAX, type SavedDeck } from '../core/presets';
import { moveItem } from '../core/reorder';
import { useMoveFocus, useReorder } from '../hooks/useReorder';
import type { CardDef } from '../core/types';
import { ConfirmAction } from './ConfirmAction';
import { DeckStrip } from './DeckStrip';

interface Props {
  decks: readonly SavedDeck[];
  current: readonly (CardDef | null)[];
  onLoad: (deck: SavedDeck) => void;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** 一覧の並び順(SavedData.decks の配列順そのもの。保存形式は変わらない) */
  onReorder: (next: SavedDeck[]) => void;
}

export function DeckPicker({ decks, current, onLoad, onSave, onRename, onDelete, onReorder }: Props) {
  const [name, setName] = useState('');
  // 名前を変更中のデッキ。変更中の行だけ入力欄に差し替える
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const complete = current.every((c) => c !== null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= decks.length) return;
    onReorder(moveItem(decks, from, to));
  };
  // つまみ(.deck-drag)だけを掴む所にする。行全体だと touch-action: none で一覧から縦スクロールできなくなる
  const reorder = useReorder({ axis: 'y', count: decks.length, onMove: move });
  const focus = useMoveFocus();
  const moveByButton = (from: number, to: number, side: 'u' | 'd') => {
    focus.after(`${to}:${side}`, `${to}:${side === 'u' ? 'd' : 'u'}`);
    move(from, to);
  };

  return (
    <div className="decks">
      {decks.length > 0 && (
        <ul className="deck-list">
          {decks.map((d, i) =>
            editing?.id === d.id ? (
              <li key={d.id} className="deck-editing">
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
              <li key={d.id} {...reorder.target(i)}>
                <span className="deck-handle">
                  <span className="deck-drag" aria-hidden="true" {...reorder.handle(i)}>⠿</span>
                  <button type="button" className="btn-tertiary deck-move-btn" disabled={i === 0}
                    ref={focus.register(`${i}:u`)}
                    onClick={() => moveByButton(i, i - 1, 'u')} aria-label={`「${d.name}」(${i + 1} 番目)を上へ`}>↑</button>
                  <button type="button" className="btn-tertiary deck-move-btn" disabled={i === decks.length - 1}
                    ref={focus.register(`${i}:d`)}
                    onClick={() => moveByButton(i, i + 1, 'd')} aria-label={`「${d.name}」(${i + 1} 番目)を下へ`}>↓</button>
                </span>
                <button type="button" className="deck-load" onClick={() => onLoad(d)}>
                  <span className="result-name">{d.name}</span>
                  <DeckStrip cards={d.cards} className="deck-strip-row" />
                </button>
                <span className="deck-actions">
                  <button type="button" className="btn-tertiary" onClick={() => setEditing({ id: d.id, name: d.name })} aria-label={`${d.name} の名前を変更`}>名前を変更</button>
                  <ConfirmAction className="btn-danger btn-sm" small label="削除" confirmLabel="削除する" aria-label={`${d.name} を削除`} onConfirm={() => onDelete(d.id)} />
                </span>
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
          <div className="deck-save-field">
            <label className="field-label" htmlFor="deck-name">デッキ名(空なら自動で付けます)</label>
            <input id="deck-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`デッキ ${decks.length + 1}`} maxLength={DECK_NAME_MAX} />
          </div>
          <button type="submit" className="btn btn-sm">今の手札を保存</button>
        </form>
      )}
    </div>
  );
}
