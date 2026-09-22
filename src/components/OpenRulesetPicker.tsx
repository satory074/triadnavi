import type { SetupDraft } from '../core/appState';
import { distinctOpenRulesets, openRulesetLabel, type OpenRulesetInfo } from '../data';

interface Props {
  draft: SetupDraft;
  onPick: (r: OpenRulesetInfo) => void;
}

/**
 * オフィシャルトーナメント(8 人・ドラフト)のルールの組。ゲームデータの 10 行のうち、ベーシック(ドラフトのみ)の 5 行は 1 つにまとめる。
 * 4 の倍数の時刻はベーシックと言われているが周期は実機で未確認なので、受付の表示に合わせて選んでもらう
 */
export function OpenRulesetPicker({ draft, onPick }: Props) {
  return (
    <div className="open-picker">
      <ul className="result-list" aria-label="オフィシャルトーナメントのルール">
        {distinctOpenRulesets().map((r) => (
          <li key={r.id}>
            <button type="button" aria-pressed={r.id === draft.openRulesetId} onClick={() => onPick(r)}>
              <span className="result-name">{openRulesetLabel(r)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="note">
        偶数時ごとに 30 分の受付があり、ベーシックとアドバンスが交互に回ります。受付の表示に合わせて選んでください。カードは全て貸し出しなので、手持ちの登録は関係ありません。
        相手は 8 人のランダムな参加者(足りなければ NPC)で、こちらと同じくドラフトで組んだ手札と想定します。
      </p>
    </div>
  );
}
