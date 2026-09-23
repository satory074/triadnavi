import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

interface Options {
  /** 手札は横('x')、保存デッキの一覧は縦('y') */
  axis: 'x' | 'y';
  count: number;
  onMove: (from: number, to: number) => void;
}

/** ドラッグと見なす移動量。これ未満はタップ/クリックとして素通しする */
const THRESHOLD = 8;

/**
 * ポインターで要素を並べ替える。HTML の標準のドラッグ&ドロップ(dragstart)は**タッチ端末で動かない**ので使わない。
 * ゲームの横でスマホから使う道具なので、マウスと指の両方で同じように動くことを優先している。
 *
 * - 閾値を超えるまでは state も書かず、掴みもしないので、ただのタップ(カードを開く / デッキを読み込む)はそのまま通る。
 * - ドラッグの直後に来るクリックは、文書全体で 1 回だけ握り潰す(arm)。
 * - `touch-action`: 横の並べ替えは 'pan-y' にして、札の上から始めた**縦スクロールをブラウザに残す**。
 *   縦の並べ替えは 'none' が要るので、掴む所(handle)を行全体ではなく専用のつまみに分ける
 *   (行全体に付けると、一覧の上からページを縦スクロールできなくなる)。
 *
 * `target(i)` = 動く要素(行き先の判定にも使う)、`handle(i)` = 掴む所。同じ要素なら `bind(i)` を使う。
 */
export function useReorder({ axis, count, onMove }: Options) {
  const start = useRef<{ id: number; x: number; y: number; from: number } | null>(null);
  const moved = useRef(false);
  const swallow = useRef<{ onClick: (e: MouseEvent) => void; onDown: () => void } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; dx: number; dy: number } | null>(null);

  const disarm = () => {
    const s = swallow.current;
    if (!s) return;
    swallow.current = null;
    document.removeEventListener('click', s.onClick, true);
    document.removeEventListener('pointerdown', s.onDown, true);
  };
  /**
   * ドラッグの直後のクリックを 1 回だけ止める。要素ごとの onClickCapture では拾えない:
   * 掴んだ要素と離した要素が違うと、click は共通の祖先(一覧の ul など)に飛ぶ。
   * ドラッグの後に click が 1 件も来ないこともある(掴んだ要素と離した要素が違う時)ので、
   * 次に押した時(pointerdown)にも必ず外す。これが無いと、次のタップを食べてしまう
   */
  const arm = () => {
    disarm();
    const onClick = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); disarm(); };
    const onDown = () => disarm();
    swallow.current = { onClick, onDown };
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerdown', onDown, true);
  };
  useEffect(() => disarm, []); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (commit: boolean) => {
    const d = drag;
    start.current = null;
    setDrag(null);
    if (moved.current) {
      moved.current = false;
      arm();
    }
    if (commit && d && d.to !== d.from) onMove(d.from, d.to);
  };

  const target = (index: number) => {
    const held = drag?.from === index;
    return {
      'data-reorder-index': index,
      className: `reorder-item${held ? ' is-dragging' : ''}${drag && drag.to === index && !held ? ' is-over' : ''}`,
      style: (held
        ? { transform: `translate(${drag.dx}px, ${drag.dy}px)`, pointerEvents: 'none', position: 'relative', zIndex: 2 }
        : {}) as CSSProperties,
    };
  };

  const handle = (index: number) => ({
    style: { touchAction: axis === 'x' ? 'pan-y' : 'none' } as CSSProperties,
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      moved.current = false;
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: index };
      // ここで setPointerCapture してはいけない: click まで掴んだ要素に付け替えられ、
      // 中の札のボタンの onClick(カードのエディタを開く)が発火しなくなる
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!moved.current) {
        // その軸の動きが主でないうちは、スクロールの意図として素通しする
        const along = axis === 'x' ? dx : dy;
        const across = axis === 'x' ? dy : dx;
        if (Math.abs(along) < THRESHOLD || Math.abs(along) <= Math.abs(across)) return;
        moved.current = true;
        // ドラッグと決まってから掴む。以降は要素の外へ出てもこの要素にイベントが届く
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
      // 掴んだ要素は pointer-events: none なので、下の要素(行き先)が取れる
      const attr = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-reorder-index]')?.getAttribute('data-reorder-index');
      const to = attr === null || attr === undefined ? -1 : Number(attr);
      setDrag({ from: s.from, to: to >= 0 && to < count ? to : s.from, dx, dy });
    },
    onPointerUp: (e: ReactPointerEvent) => {
      if (start.current?.id !== e.pointerId) return;
      finish(true);
    },
    onPointerCancel: (e: ReactPointerEvent) => {
      if (start.current?.id !== e.pointerId) return;
      finish(false);
    },
  });

  /** 掴む所と動く要素が同じ場合(自分の手札の札) */
  const bind = (index: number) => {
    const t = target(index);
    const h = handle(index);
    return { ...t, ...h, style: { ...h.style, ...t.style } };
  };

  return { bind, target, handle, dragging: drag?.from ?? null };
}

/**
 * ボタンで並べ替えた後、動いた先の同じ向きのボタンへフォーカスを戻す。
 * 端に着いてそのボタンが無効になった時(最後尾へ動かした時の「→」など)は、逆向きのボタンへ逃がす。
 * 状態の更新関数の中では何もしない(StrictMode で 2 回走るため)。
 */
export function useMoveFocus() {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pending = useRef<{ key: string; alt: string } | null>(null);
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const el = refs.current[p.key];
    if (el && !el.disabled) el.focus();
    else refs.current[p.alt]?.focus();
  });
  return {
    register: (key: string) => (el: HTMLButtonElement | null) => { refs.current[key] = el; },
    after: (key: string, alt: string) => { pending.current = { key, alt }; },
  };
}
