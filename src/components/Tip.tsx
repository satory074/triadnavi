import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** 吹き出しと要素の間、画面の端との間の余白(px) */
const GAP = 6;
const MARGIN = 8;

interface Props {
  id: string;
  /** 乗せた要素の画面上の位置 */
  anchor: DOMRect;
  className?: string;
  children: ReactNode;
}

/** 吹き出しの殻。要素の下に出し、入りきらなければ上。左右は画面の中に収める(手持ちの入手方法とルールの説明で共用) */
export function Tip({ id, anchor, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // 大きさは描いてみないと分からないので、描いた直後(画面に出る前)に位置を決める。
  // style を props で渡すと再描画のたびに React が上書きするので、要素に直接書く
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const below = anchor.bottom + GAP;
    const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, anchor.top - GAP - height);
    const left = Math.min(Math.max(MARGIN, anchor.left + anchor.width / 2 - width / 2), vw - MARGIN - width);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = 'visible';
  }, [anchor, children]);

  return (
    <div ref={ref} id={id} role="tooltip" className={className ? `tip ${className}` : 'tip'}>
      {children}
    </div>
  );
}
