import { SELECTABLE_RULE_IDS } from '../core/appState';
import { RULE_NAMES } from '../core/rules';

interface Props {
  ruleIds: readonly number[];
  onToggle: (id: number) => void;
}

export function RuleChips({ ruleIds, onToggle }: Props) {
  return (
    <div className="chips" role="group" aria-label="有効なルール">
      {SELECTABLE_RULE_IDS.map((id) => (
        <button type="button" key={id} className={`chip${ruleIds.includes(id) ? ' chip-on' : ''}`} aria-pressed={ruleIds.includes(id)} onClick={() => onToggle(id)}>
          {RULE_NAMES[id]}
        </button>
      ))}
    </div>
  );
}
