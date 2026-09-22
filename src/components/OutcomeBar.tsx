interface Props {
  /** 0〜1 の割合(合計が 1 でなくてもよい。帯の中で比率にする) */
  win: number;
  draw: number;
  loss: number;
  label?: string;
}

/** 勝ち・引き分け・負けの割合を 1 本の帯で見せる。数字は文で添える前提で、帯は一目で比を掴むためのもの */
export function OutcomeBar({ win, draw, loss, label = '勝ち・引き分け・負けの割合' }: Props) {
  const total = win + draw + loss || 1;
  const pct = (x: number) => Math.round((100 * Math.max(0, x)) / total);
  return (
    <div className="outcome-bar" role="img" aria-label={`${label}: 勝ち ${pct(win)}%、引き分け ${pct(draw)}%、負け ${pct(loss)}%`}>
      <span className="outcome-win" style={{ width: `${pct(win)}%` }} />
      <span className="outcome-draw" style={{ width: `${pct(draw)}%` }} />
      <span className="outcome-loss" style={{ width: `${pct(loss)}%` }} />
    </div>
  );
}
