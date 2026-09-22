import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * ネイティブの <dialog>。showModal() で、フォーカスの閉じ込め・Escape・背景の inert 化をブラウザに任せる。
 * 閉じる時は、開く前にフォーカスがあった要素へ戻す。
 * 対局画面の Enter の処理は `dialog[open]` を見て、ダイアログが開いている間は効かないようにしている。
 */
export function Modal({ title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // こちらから close() している最中(unmount)は、close イベントで onClose を呼び直さない
  const closing = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement;
    // StrictMode では effect が 2 回走る。開いている dialog に showModal() すると例外
    if (!d.open) d.showModal();
    return () => {
      closing.current = true;
      if (d.open) d.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // ブラウザ側で閉じられた時(Escape の連打など)に、React の状態も追従させる
      onClose={() => {
        if (!closing.current) onClose();
      }}
      // 背景のクリック。中身は .modal-body が覆っているので、dialog 自身がターゲットなら背景
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-body">
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn-tertiary" onClick={onClose}>閉じる</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
