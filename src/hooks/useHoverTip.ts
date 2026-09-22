import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from 'react';

/** 乗せてから出るまで。なぞっただけで吹き出しがちらつかないように(手持ちの画面と同じ) */
const SHOW_MS = 250;
/** 離れてから消えるまで。隣へ移る間に消えず、そのまま切り替わるように */
const HIDE_MS = 80;

export interface HoverTipState {
  key: string;
  text: string;
  anchor: DOMRect;
}

/**
 * 短い説明の吹き出し(ルールの説明)。手持ちの画面の入手方法と同じ決まりで出す:
 * マウスは乗せて 250ms 後(スマホのタップでも pointerenter は来るが、出すと次に触るまで残るので mouse に絞る)、
 * キーボードは :focus-visible の時だけ(マウスで押した後に残るフォーカスで出すと、離れても消えなくなる)。
 * 吹き出しは画面に固定した位置に出すので、スクロール・リサイズ・Escape・ほかの所を触ったら消す。
 * 手持ちの画面は所持の切り替えとタップのモードが絡むので、このフックは使っていない。
 */
export function useHoverTip() {
  const id = useId();
  const [tip, setTip] = useState<HoverTipState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const openKey = useRef<string | null>(null);

  const show = useCallback((next: HoverTipState | null) => {
    window.clearTimeout(timer.current);
    openKey.current = next?.key ?? null;
    setTip(next);
  }, []);

  const hover = (key: string | null, text?: string, el?: HTMLElement) => {
    window.clearTimeout(timer.current);
    if (key !== null && text && el) {
      const go = () => show({ key, text, anchor: el.getBoundingClientRect() });
      // 既に出ている時(隣へ移った時)は待たずに切り替える
      if (openKey.current !== null) go();
      else timer.current = window.setTimeout(go, SHOW_MS);
    } else {
      timer.current = window.setTimeout(() => show(null), HIDE_MS);
    }
  };

  /** 吹き出しを出す要素に付ける props。今出している要素を触っても、外を触った扱いにしない(data-tip で見分ける) */
  const bind = (key: string, text: string) => ({
    'data-tip': key,
    'aria-describedby': tip?.key === key ? id : undefined,
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') hover(key, text, e.currentTarget);
    },
    onPointerLeave: () => hover(null),
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(':focus-visible')) hover(key, text, e.currentTarget);
    },
    onBlur: () => hover(null),
  });

  /** タップで出し入れする(押しても他に何も起きない要素用。タッチの端末でも説明を見られるように)。マウスのクリックでは消さない */
  const toggle = (key: string, text: string, e: MouseEvent<HTMLElement>) => {
    const mouse = 'pointerType' in e.nativeEvent && (e.nativeEvent as globalThis.PointerEvent).pointerType === 'mouse';
    if (openKey.current === key && !mouse) show(null);
    else show({ key, text, anchor: e.currentTarget.getBoundingClientRect() });
  };

  const shown = tip !== null;
  useEffect(() => {
    if (!shown) return;
    const hide = () => show(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // ダイアログの中では、Escape で吹き出しだけを消す(ダイアログまで閉じない)
      e.preventDefault();
      hide();
    };
    const onDown = (e: globalThis.PointerEvent) => {
      const on = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
      if (on?.getAttribute('data-tip') !== openKey.current) hide();
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
  }, [shown, show]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { id, tip, bind, toggle };
}
