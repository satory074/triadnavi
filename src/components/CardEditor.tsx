import { useCallback, useEffect, useState } from 'react';
import { CARD_TYPE_NAMES, type CardDef, type CardType, type Sides } from '../core/types';
import { findBySides, searchCards, toCardDef, type CardInfo } from '../data';
import { CardView } from './CardView';
import { Modal } from './Modal';
import { SideKeypad } from './SideKeypad';

interface Props {
  title: string;
  owner: 0 | 1;
  /** タイプアセンド/ディセンドが有効か(有効な時だけタイプの確認を求める) */
  typeMatters: boolean;
  onCommit: (card: CardDef) => void;
  onClose: () => void;
}

const SIDE_NAMES = ['上', '右', '下', '左'];

/**
 * カード 1 枚の入力。数字を 4 つ打つと同梱データから名前とタイプを自動判定して確定する。
 * 確認を求めるのは、タイプが結果に影響し、かつ数字だけではタイプが決まらない時だけ。
 */
export function CardEditor({ title, owner, typeMatters, onCommit, onClose }: Props) {
  const [digits, setDigits] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<{ sides: Sides; candidates: CardInfo[] } | null>(null);

  const resolve = useCallback(
    (sides: Sides) => {
      const candidates = findBySides(sides);
      const types = new Set(candidates.map((c) => c.type));
      if (candidates.length === 1 || (candidates.length > 1 && (types.size === 1 || !typeMatters))) {
        // 名前を連結するのは、どのカードか決まらない印。artIdOf はこの形では絵を出さない(片方の名前だけにしないこと)
        onCommit({ sides, type: candidates[0].type, label: candidates.map((c) => c.name).join(' / ') });
        setDigits([]);
      } else if (candidates.length === 0 && !typeMatters) {
        onCommit({ sides, type: 0 });
        setDigits([]);
      } else {
        setPending({ sides, candidates });
      }
    },
    [onCommit, typeMatters],
  );

  // 確定処理(副作用)は状態の更新関数の中に入れない。StrictMode では更新関数が 2 回走り、二重に確定してしまう
  const push = useCallback(
    (v: number) => {
      if (pending || digits.length >= 4) return;
      const next = [...digits, v];
      setDigits(next);
      if (next.length === 4) resolve(next as unknown as Sides);
    },
    [pending, digits, resolve],
  );

  const back = useCallback(() => {
    setPending(null);
    setDigits((d) => d.slice(0, -1));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (/^[1-9]$/.test(e.key)) push(Number(e.key));
      else if (e.key === '0' || e.key.toLowerCase() === 'a') push(10);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [push, back]);

  const choose = (card: CardDef) => {
    onCommit(card);
    setPending(null);
    setDigits([]);
  };

  const results = searchCards(query, 12);

  return (
    <Modal title={title} onClose={onClose}>
      <div className="editor">
        <div className="editor-preview">
          <CardView card={null} owner={owner} size="lg" partial={digits} />
          <p className="editor-hint">
            {pending ? 'タイプを選んでください' : digits.length < 4 ? `${SIDE_NAMES[digits.length]}の数字` : '確認中'}
          </p>
        </div>

        {pending ? (
          <div className="editor-choice">
            {pending.candidates.length > 0 ? (
              <>
                <p>同じ数字のカードが複数あります。タイプが違うので、どちらかを選んでください。</p>
                {pending.candidates.map((c) => (
                  <button type="button" key={c.id} className="btn" onClick={() => choose(toCardDef(c))}>
                    {c.name}(タイプ: {CARD_TYPE_NAMES[c.type]})
                  </button>
                ))}
              </>
            ) : (
              <>
                <p>データに無い数字の組です。タイプアセンド/ディセンドが有効なので、タイプを選んでください。</p>
                {CARD_TYPE_NAMES.map((name, t) => (
                  <button type="button" key={name} className="btn" onClick={() => choose({ sides: pending.sides, type: t as CardType })}>
                    {name}
                  </button>
                ))}
              </>
            )}
            <button type="button" className="btn-tertiary" onClick={back}>打ち直す</button>
          </div>
        ) : (
          <SideKeypad onDigit={push} onBackspace={back} />
        )}

        <div className="editor-search">
          <label htmlFor="card-search">名前で探す</label>
          <input id="card-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例: いふりーと" autoComplete="off" />
          {results.length > 0 && (
            <ul className="result-list">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { choose(toCardDef(c)); setQuery(''); }}>
                    <span className="result-name">{c.name}</span>
                    <span className="result-sides">{c.sides.map((v) => (v === 10 ? 'A' : v)).join(' ')}</span>
                    {c.type !== 0 && <span className="result-type">{CARD_TYPE_NAMES[c.type]}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
