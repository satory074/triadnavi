import { RULE_HELP, RULE_NAMES } from '../core/rules';
import { useHoverTip } from '../hooks/useHoverTip';
import { Tip } from './Tip';

/**
 * ルール名の並び。マウスを乗せる・キーボードで移る・タップすると、そのルールの説明が出る
 * (押しても説明が出るだけ。スマホでも対局中にルールの意味を確かめられるように)
 */
export function RuleNames({ ids }: { ids: readonly number[] }) {
  const { id, tip, bind, toggle } = useHoverTip();
  return (
    <span className="rule-names">
      {ids.map((r) => {
        const key = String(r);
        const text = RULE_HELP[r] ?? '';
        return (
          <button type="button" key={r} className="rule-name" {...bind(key, text)} onClick={(e) => toggle(key, text, e)}>
            {RULE_NAMES[r]}
          </button>
        );
      })}
      {tip && <Tip id={id} anchor={tip.anchor}>{tip.text}</Tip>}
    </span>
  );
}
