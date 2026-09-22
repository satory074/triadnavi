import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** 1 回目に見せる文言(アイコン付きでもよい) */
  label: ReactNode;
  /** 2 回目(本当に実行する)ボタンの文言 */
  confirmLabel: string;
  onConfirm: () => void;
  /** 1 回目のボタンの class(既定は赤い枠の .btn-danger) */
  className?: string;
  disabled?: boolean;
  /** 文の中に置く小さい版(確認と「やめる」も小さくする) */
  small?: boolean;
  /** 放っておいて元に戻るまで(ms) */
  timeoutMs?: number;
  'aria-label'?: string;
}

/** 1 回目のクリックから、これより短い間隔の確定は無視する(ダブルクリックで通り抜けないように) */
const DOUBLE_CLICK_GUARD_MS = 350;

/**
 * 取り消せない操作の 2 段階ボタン。1 回目で「[confirmLabel] [やめる]」に変わり、放っておくと元に戻る。
 * window.confirm は自動操作を止め、見た目も選べないので使わない。
 */
export function ConfirmAction({ label, confirmLabel, onConfirm, className = 'btn-danger', disabled, small, timeoutMs = 4000, 'aria-label': ariaLabel }: Props) {
  const sm = small ? ' btn-sm' : '';
  const [armed, setArmed] = useState(false);
  const armedAt = useRef(0);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armed) return;
    confirmRef.current?.focus();
    const t = window.setTimeout(() => setArmed(false), timeoutMs);
    return () => window.clearTimeout(t);
  }, [armed, timeoutMs]);

  if (!armed) {
    return (
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => {
          armedAt.current = Date.now();
          setArmed(true);
        }}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-action" role="group" aria-label={ariaLabel ?? confirmLabel}>
      <button
        ref={confirmRef}
        type="button"
        className={`btn-danger${sm}`}
        onClick={() => {
          if (Date.now() - armedAt.current < DOUBLE_CLICK_GUARD_MS) return;
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className={`btn-tertiary${sm}`} onClick={() => setArmed(false)}>やめる</button>
    </span>
  );
}
