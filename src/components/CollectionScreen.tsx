import { memo, useCallback, useMemo, useState } from 'react';
import { exportCollection, importCollection, withOwned, type Collection } from '../core/collection';
import { CARD_TYPE_NAMES } from '../core/types';
import { CARDS, CARDS_IN_LIST_ORDER, cardNumber, normalize, ownedCards, toCardDef, type CardInfo } from '../data';
import { CardView } from './CardView';

interface Props {
  collection: Collection;
  onChange: (next: Collection | ((prev: Collection) => Collection)) => void;
  onClose: () => void;
}

type OwnedFilter = 'all' | 'owned' | 'missing';

const STARS = [1, 2, 3, 4, 5];
const searchIndex = new Map(CARDS.map((c) => [c.id, normalize(c.name)]));

interface CellProps {
  card: CardInfo;
  owned: boolean;
  onToggle: (id: number) => void;
}

/** 475 枚を並べるので、所持が変わったカードだけ描き直す */
const CollectionCell = memo(function CollectionCell({ card, owned, onToggle }: CellProps) {
  return (
    <button
      type="button"
      className={`coll-cell${owned ? ' is-owned' : ''}`}
      aria-pressed={owned}
      aria-label={`${cardNumber(card)} ${card.name} ★${card.stars}`}
      onClick={() => onToggle(card.id)}
    >
      <CardView card={toCardDef(card)} owner={owned ? 0 : 'none'} size="sm" showName={false} />
      <span className="coll-no">{cardNumber(card)} <span className="coll-stars">★{card.stars}</span></span>
      <span className="pool-name">{card.name}</span>
    </button>
  );
});

/** 手持ちの登録。ゲーム内のカードリストと同じ並びで見比べながら、タップで所持を切り替える */
export function CollectionScreen({ collection, onChange, onClose }: Props) {
  const [star, setStar] = useState<number | null>(null);
  const [type, setType] = useState<number | null>(null);
  const [ownedFilter, setOwnedFilter] = useState<OwnedFilter>('all');
  const [query, setQuery] = useState('');
  const [importText, setImportText] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const ownedSet = useMemo(() => new Set(collection.owned), [collection]);
  const known = useMemo(() => ownedCards(collection), [collection]);

  const shown = useMemo(() => {
    const q = normalize(query);
    return CARDS_IN_LIST_ORDER.filter(
      (c) =>
        (star === null || c.stars === star) &&
        (type === null || c.type === type) &&
        (ownedFilter === 'all' || ownedSet.has(c.id) === (ownedFilter === 'owned')) &&
        (q === '' || (searchIndex.get(c.id) ?? '').includes(q)),
    );
    // ownedSet は依存に入れない: 「所持」「未所持」で絞っている時にタップした瞬間カードが消えると、押し間違いを直せない。
    // 絞り込みを変えた時点の所持で並べ、その後の付け外しでは並びを変えない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [star, type, ownedFilter, query]);

  const toggle = useCallback(
    (id: number) => onChange((prev) => withOwned(prev, [id], !prev.owned.includes(id))),
    [onChange],
  );

  const setShown = (owned: boolean) => {
    const ids = shown.map((c) => c.id);
    onChange((prev) => withOwned(prev, ids, owned));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportCollection(collection));
      setMessage('コピーしました');
    } catch {
      setMessage('コピーできませんでした。下の文字列を選択してコピーしてください');
    }
  };

  const runImport = (replace: boolean) => {
    const ids = importCollection(importText);
    if (ids === null) {
      setMessage('読み込めませんでした。カード ID をカンマ区切りで入れてください(例: 1-53,60,72)');
      return;
    }
    onChange((prev) => withOwned(replace ? { owned: [] } : prev, ids, true));
    setOwnedFilter('all');
    setImportText('');
    setMessage(`${ids.length} 枚を読み込みました`);
  };

  return (
    <main className="collection">
      <div className="coll-head">
        <h2>手持ちのカード</h2>
        <span className="muted">所持 {known.length} / {CARDS.length} 枚</span>
        <button type="button" className="btn-quiet" onClick={onClose}>戻る</button>
      </div>
      <p className="note">ゲーム内の「カードリスト」と同じ並びです。持っているカードをタップしてください。ここで登録した手持ちから、対戦相手に合わせたデッキを探せます。</p>

      <div className="coll-filters">
        <div className="chips" role="group" aria-label="レアリティで絞り込む">
          <button type="button" className={`chip${star === null ? ' chip-on' : ''}`} aria-pressed={star === null} onClick={() => setStar(null)}>全て</button>
          {STARS.map((s) => {
            const all = CARDS.filter((c) => c.stars === s);
            const have = all.filter((c) => ownedSet.has(c.id)).length;
            return (
              <button type="button" key={s} className={`chip${star === s ? ' chip-on' : ''}`} aria-pressed={star === s} onClick={() => setStar(star === s ? null : s)}>
                ★{s} <span className="coll-count">{have}/{all.length}</span>
              </button>
            );
          })}
        </div>
        <div className="chips" role="group" aria-label="タイプで絞り込む">
          {CARD_TYPE_NAMES.map((name, t) => (
            <button type="button" key={t} className={`chip${type === t ? ' chip-on' : ''}`} aria-pressed={type === t} onClick={() => setType(type === t ? null : t)}>
              {t === 0 ? 'タイプなし' : name}
            </button>
          ))}
        </div>
        <div className="coll-row">
          <div className="segmented" role="group" aria-label="所持で絞り込む">
            {(['all', 'owned', 'missing'] as const).map((f) => (
              <button type="button" key={f} className={ownedFilter === f ? 'seg-on' : ''} aria-pressed={ownedFilter === f} onClick={() => setOwnedFilter(f)}>
                {f === 'all' ? '全て' : f === 'owned' ? '所持' : '未所持'}
              </button>
            ))}
          </div>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="カード名で探す" aria-label="カード名で探す" />
        </div>
        <div className="coll-row">
          <span className="muted">表示中 {shown.length} 枚</span>
          <button type="button" className="btn-quiet" disabled={shown.length === 0} onClick={() => setShown(true)}>表示中を全て所持にする</button>
          <button type="button" className="btn-quiet" disabled={shown.length === 0} onClick={() => setShown(false)}>表示中を全て外す</button>
        </div>
      </div>

      <div className="coll-grid">
        {shown.map((c) => (
          <CollectionCell key={c.id} card={c} owned={ownedSet.has(c.id)} onToggle={toggle} />
        ))}
      </div>
      {shown.length === 0 && <p className="result-empty">条件に合うカードがありません</p>}

      <section className="coll-io">
        <h3>控えを取る/別の端末へ移す</h3>
        <p className="note">手持ちはこのブラウザにだけ保存されます。下の文字列を控えておけば、消えた時や別の端末で読み込めます。</p>
        <textarea readOnly value={exportCollection(collection)} rows={3} aria-label="手持ちの書き出し" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn-quiet" onClick={copy}>コピー</button>
        <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={3} placeholder="控えた文字列、またはカード ID(例: 1-53,60,72)" aria-label="手持ちの読み込み" />
        <div className="coll-row">
          <button type="button" className="btn-quiet" disabled={importText.trim() === ''} onClick={() => runImport(false)}>今の手持ちに追加する</button>
          <button type="button" className="btn-quiet" disabled={importText.trim() === ''} onClick={() => runImport(true)}>今の手持ちと置き換える</button>
        </div>
        {message && <p className="note note-warn" role="status">{message}</p>}
      </section>
    </main>
  );
}
