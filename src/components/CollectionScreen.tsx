import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportCollection, importCollection, withOwned, type Collection } from '../core/collection';
import { CARD_TYPE_NAMES } from '../core/types';
import { CARDS, CARDS_IN_LIST_ORDER, achievementStatus, cardNumber, normalize, ownedCards, ownershipPercent, toCardDef, type AchievementStatus, type CardInfo } from '../data';
import { CardView } from './CardView';
import { ConfirmAction } from './ConfirmAction';
import { SourceTip } from './SourceTip';

interface Props {
  collection: Collection;
  onChange: (next: Collection | ((prev: Collection) => Collection)) => void;
  onClose: () => void;
}

type OwnedFilter = 'all' | 'owned' | 'missing';
/** タップした時の動作。マウスの hover は常に入手方法を出すので、これはタッチのための切り替え */
type TapMode = 'own' | 'source';

const STARS = [1, 2, 3, 4, 5];
const searchIndex = new Map(CARDS.map((c) => [c.id, normalize(c.name)]));

const TIP_ID = 'coll-source-tip';
/** 乗せてから入手方法が出るまで。カードの上をなぞっただけで吹き出しがちらつかないように */
const TIP_SHOW_MS = 250;
/** 離れてから消えるまで。隣のカードへ移る間に消えず、そのまま切り替わるように */
const TIP_HIDE_MS = 80;

interface CellProps {
  card: CardInfo;
  owned: boolean;
  /** このカードの入手方法を吹き出しに出している */
  described: boolean;
  /** タップ。所持の切り替えか入手方法かは親が決める(モードを prop にすると memo が効かなくなる) */
  onTap: (card: CardInfo, el: HTMLElement) => void;
  onHover: (card: CardInfo | null, el?: HTMLElement) => void;
}

/** 475 枚を並べるので、所持が変わったカードだけ描き直す */
const CollectionCell = memo(function CollectionCell({ card, owned, described, onTap, onHover }: CellProps) {
  return (
    <button
      type="button"
      className={`coll-cell${owned ? ' is-owned' : ''}`}
      aria-pressed={owned}
      aria-label={`${cardNumber(card)} ${card.name} ★${card.stars}`}
      aria-describedby={described ? TIP_ID : undefined}
      onClick={(e) => onTap(card, e.currentTarget)}
      // マウスの時だけ出す。スマホのタップでも pointerenter は来るが、出すと次に触るまで残ってしまう
      onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(card, e.currentTarget)}
      onPointerLeave={() => onHover(null)}
      // キーボードで移った時だけ出す。マウスで押した後に残るフォーカスでは出さない(離れても消えなくなる)
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && onHover(card, e.currentTarget)}
      onBlur={() => onHover(null)}
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
  const [tip, setTip] = useState<{ card: CardInfo; anchor: DOMRect } | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const tipOpen = useRef(false);
  const tipCard = useRef<number | null>(null);
  // ref で持つのは、memo した CollectionCell に渡す onTap を作り直さないため。表示用に state を鏡にする
  const tapMode = useRef<TapMode>('own');
  const [tapModeView, setTapModeView] = useState<TapMode>('own');

  const ownedSet = useMemo(() => new Set(collection.owned), [collection]);
  const known = useMemo(() => ownedCards(collection), [collection]);
  const percent = ownershipPercent(known.length);
  const achievements = useMemo(() => achievementStatus(known), [known]);
  const achievedCount = achievements.filter((a) => a.done).length;

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

  const showTip = useCallback((next: { card: CardInfo; anchor: DOMRect } | null) => {
    window.clearTimeout(tipTimer.current);
    tipOpen.current = next !== null;
    tipCard.current = next?.card.id ?? null;
    setTip(next);
  }, []);

  const setMode = (m: TapMode) => {
    tapMode.current = m;
    setTapModeView(m);
    showTip(null);
  };

  const onTap = useCallback(
    (card: CardInfo, el: HTMLElement) => {
      if (tapMode.current === 'own') {
        toggle(card.id);
        return;
      }
      // 入手方法を見るモード: タップで出し、同じカードをもう一度タップすると消す
      if (tipCard.current === card.id) showTip(null);
      else showTip({ card, anchor: el.getBoundingClientRect() });
    },
    [toggle, showTip],
  );

  const hover = useCallback(
    (card: CardInfo | null, el?: HTMLElement) => {
      window.clearTimeout(tipTimer.current);
      if (card && el) {
        const show = () => showTip({ card, anchor: el.getBoundingClientRect() });
        // 既に出ている時(隣のカードへ移った時)は待たずに切り替える
        if (tipOpen.current) show();
        else tipTimer.current = window.setTimeout(show, TIP_SHOW_MS);
      } else {
        tipTimer.current = window.setTimeout(() => showTip(null), TIP_HIDE_MS);
      }
    },
    [showTip],
  );

  // 吹き出しは画面に固定した位置に出すので、スクロールしたらカードとずれる。消して、次に乗せた時に出し直す
  const tipShown = tip !== null;
  useEffect(() => {
    if (!tipShown) return;
    const hide = () => showTip(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    // カード以外を触ったら消す(タップで出した吹き出しは、そのままでは残る)
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.coll-cell')) hide();
    };
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('resize', hide);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, { capture: true });
    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('resize', hide);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, { capture: true });
    };
  }, [tipShown, showTip]);

  useEffect(() => () => window.clearTimeout(tipTimer.current), []);

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
        <span className="muted">所持 {known.length} / {CARDS.length} 枚(所有率 {percent}%)</span>
        <button type="button" className="btn-tertiary" onClick={onClose}>戻る</button>
      </div>
      <div className="meter" role="progressbar" aria-label="所有率" aria-valuemin={0} aria-valuemax={CARDS.length} aria-valuenow={known.length} aria-valuetext={`${percent}%`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="note">ゲーム内のカードリストと同じ並びです。持っているカードをタップしてください。登録した手持ちから、対戦相手に合わせたデッキを探せます。</p>

      {/* 読むだけの情報なので畳んでおき、絞り込みとカード一覧を先頭に近づける */}
      <details className="coll-achv">
        <summary><h3>アチーブメント <span className="muted">達成 {achievedCount} / {achievements.length}</span></h3></summary>
        <ul className="achv-list">
          {achievements.map((a) => (
            <li key={a.achievement.id} className={`achv${a.done ? ' is-done' : ''}`}>
              <span className="achv-name">{a.achievement.name}</span>
              <span className="achv-cond">{achievementCondition(a)}</span>
              {a.done ? (
                <span className="achv-count">達成</span>
              ) : (
                <>
                  <span className="achv-count">{a.have} / {a.need}(あと {a.need - a.have})</span>
                  <span className="achv-meter" aria-hidden="true"><span style={{ width: `${(100 * a.have) / a.need}%` }} /></span>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="note">ここで登録した手持ちから判定しています。ゲーム内の達成状況とは、登録が漏れている分だけずれます。</p>
      </details>

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
        <div className="coll-row coll-tapmode">
          <span className="muted">タップで</span>
          <div className="segmented" role="group" aria-label="タップした時の動作">
            <button type="button" className={tapModeView === 'own' ? 'seg-on' : ''} aria-pressed={tapModeView === 'own'} onClick={() => setMode('own')}>所持を切り替え</button>
            <button type="button" className={tapModeView === 'source' ? 'seg-on' : ''} aria-pressed={tapModeView === 'source'} onClick={() => setMode('source')}>入手方法を見る</button>
          </div>
        </div>
        <div className="coll-row">
          <span className="muted">表示中 {shown.length} 枚</span>
          <button type="button" className="btn-tertiary" disabled={shown.length === 0} onClick={() => setShown(true)}>表示中を全て所持にする</button>
          <ConfirmAction className="btn-danger btn-sm" small label="表示中を全て外す" confirmLabel={`${shown.length} 枚を外す`} disabled={shown.length === 0} onConfirm={() => setShown(false)} />
        </div>
      </div>

      <div className="coll-grid">
        {shown.map((c) => (
          <CollectionCell key={c.id} card={c} owned={ownedSet.has(c.id)} described={tip?.card.id === c.id} onTap={onTap} onHover={hover} />
        ))}
      </div>
      {shown.length === 0 && <p className="result-empty">条件に合うカードがありません</p>}
      {tip && <SourceTip id={TIP_ID} card={tip.card} anchor={tip.anchor} />}

      <section className="coll-io">
        <h3>控えを取る/別の端末へ移す</h3>
        <p className="note">手持ちはこのブラウザにだけ保存されます。下の文字列を控えておけば、消えた時や別の端末で読み込めます。</p>
        <textarea readOnly value={exportCollection(collection)} rows={3} aria-label="手持ちの書き出し" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn-tertiary" onClick={copy}>コピー</button>
        <label className="field-label" htmlFor="coll-import">読み込む文字列(控えた文字列か、カード ID をカンマ区切りで。例: 1-53,60,72)</label>
        <textarea id="coll-import" value={importText} onChange={(e) => setImportText(e.target.value)} rows={3} placeholder="例: 1-53,60,72" />
        <div className="coll-row">
          <button type="button" className="btn btn-sm" disabled={importText.trim() === ''} onClick={() => runImport(false)}>今の手持ちに追加する</button>
          <ConfirmAction className="btn-danger btn-sm" small label="今の手持ちと置き換える" confirmLabel="置き換える(今の手持ちは消えます)" disabled={importText.trim() === ''} onConfirm={() => runImport(true)} />
        </div>
        {message && <p className="note note-warn" role="status">{message}</p>}
      </section>
    </main>
  );
}

/** アチーブメントの達成条件(ゲーム内の説明文を短くしたもの) */
function achievementCondition({ achievement: a }: AchievementStatus): string {
  return 'count' in a ? `カードを ${a.count} 種類入手する` : `No.${a.from}〜No.${a.to} をすべて入手する`;
}
