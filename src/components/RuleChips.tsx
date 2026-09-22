import { RULE_ID, RULE_NAMES } from '../core/rules';

interface Props {
  ruleIds: readonly number[];
  onToggle: (id: number) => void;
}

/** 独立して選べるルール */
const TOGGLES: readonly number[] = [RULE_ID.same, RULE_ID.plus, RULE_ID.reverse, RULE_ID.fallenAce, RULE_ID.suddenDeath];

/**
 * 公式に排他の 3 組。独立したチップに見えると両方選べると思われるので、「なし / A / B」のセグメントで見せる。
 * 排他の処理は toggleRule にあるので、ここは「なし」で有効な方を外し、A/B で選ぶだけ
 */
const GROUPS: readonly { label: string; none: string; ids: readonly number[]; short: Record<number, string> }[] = [
  { label: 'オープン', none: 'なし', ids: [RULE_ID.threeOpen, RULE_ID.allOpen], short: { [RULE_ID.threeOpen]: 'スリー', [RULE_ID.allOpen]: 'オール' } },
  { label: 'タイプ', none: 'なし', ids: [RULE_ID.ascension, RULE_ID.descension], short: { [RULE_ID.ascension]: 'アセンド', [RULE_ID.descension]: 'ディセンド' } },
  { label: '出す順', none: '自由', ids: [RULE_ID.order, RULE_ID.chaos], short: { [RULE_ID.order]: 'オーダー', [RULE_ID.chaos]: 'カオス' } },
];

export function RuleChips({ ruleIds, onToggle }: Props) {
  return (
    <div className="rule-picker" role="group" aria-label="有効なルール">
      <div className="chips">
        {TOGGLES.map((id) => (
          <button type="button" key={id} className={`chip${ruleIds.includes(id) ? ' chip-on' : ''}`} aria-pressed={ruleIds.includes(id)} onClick={() => onToggle(id)}>
            {RULE_NAMES[id]}
          </button>
        ))}
      </div>
      <div className="rule-groups">
        {GROUPS.map((g) => {
          const active = g.ids.find((id) => ruleIds.includes(id));
          return (
            <div className="rule-group" key={g.label}>
              <span className="rule-group-label">{g.label}</span>
              <div className="segmented" role="group" aria-label={g.label}>
                <button
                  type="button"
                  className={active === undefined ? 'seg-on' : ''}
                  aria-pressed={active === undefined}
                  onClick={() => {
                    if (active !== undefined) onToggle(active);
                  }}
                >
                  {g.none}
                </button>
                {g.ids.map((id) => (
                  <button
                    type="button"
                    key={id}
                    className={active === id ? 'seg-on' : ''}
                    aria-pressed={active === id}
                    aria-label={RULE_NAMES[id]}
                    onClick={() => {
                      if (active !== id) onToggle(id);
                    }}
                  >
                    {g.short[id]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
