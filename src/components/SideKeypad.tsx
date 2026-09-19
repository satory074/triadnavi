interface Props {
  onDigit: (v: number) => void;
  onBackspace: () => void;
}

const KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** 1〜9 と A。辺の入力は 上 → 右 → 下 → 左 の順に自動で進む */
export function SideKeypad({ onDigit, onBackspace }: Props) {
  return (
    <div className="keypad" role="group" aria-label="数字の入力">
      {KEYS.map((k) => (
        <button type="button" key={k} className="key" onClick={() => onDigit(k)}>{k}</button>
      ))}
      <button type="button" className="key key-wide" onClick={() => onDigit(10)}>A</button>
      <button type="button" className="key key-back" onClick={onBackspace} aria-label="1 つ消す">消す</button>
    </div>
  );
}
