import { RULE_HELP, RULE_ID, RULE_NAMES } from '../core/rules';
import { useHoverTip } from '../hooks/useHoverTip';
import { Tip } from './Tip';

interface Props {
  ruleIds: readonly number[];
  onToggle: (id: number) => void;
  /** スワップ(対戦前に決まるルール)。onSwap を渡さない画面ではチップも説明も出さない */
  swap?: boolean;
  onSwap?: (next: boolean) => void;
}

/** 独立して選べるルール */
const TOGGLES: readonly number[] = [RULE_ID.same, RULE_ID.plus, RULE_ID.reverse, RULE_ID.fallenAce, RULE_ID.suddenDeath];

/**
 * 公式に排他の 3 組。独立したチップに見えると両方選べると思われるので、「なし / A / B」のセグメントで見せる。
 * 排他の処理は toggleRule にあるので、ここは「なし」で有効な方を外し、A/B で選ぶだけ
 */
const GROUPS: readonly { label: string; none: string; noneHelp: string; ids: readonly number[]; short: Record<number, string> }[] = [
  {
    label: 'オープン', none: 'なし', noneHelp: '相手の手札は裏向きで、出されるまで分かりません。',
    ids: [RULE_ID.threeOpen, RULE_ID.allOpen], short: { [RULE_ID.threeOpen]: 'スリー', [RULE_ID.allOpen]: 'オール' },
  },
  {
    label: 'タイプ', none: 'なし', noneHelp: 'タイプによって数字が強くなったり弱くなったりしません。',
    ids: [RULE_ID.ascension, RULE_ID.descension], short: { [RULE_ID.ascension]: 'アセンド', [RULE_ID.descension]: 'ディセンド' },
  },
  {
    label: '出す順', none: '自由', noneHelp: '手札のどのカードでも、好きな順に出せます。',
    ids: [RULE_ID.order, RULE_ID.chaos], short: { [RULE_ID.order]: 'オーダー', [RULE_ID.chaos]: 'カオス' },
  },
];

/** 下の「ルールの説明」に並べる順(画面の並びと同じ) */
const ALL_IDS: readonly number[] = [...TOGGLES, ...GROUPS.flatMap((g) => g.ids)];

/**
 * ルールの選択(設定画面と、対局中の「ルールを変更」)。マウスを乗せるとルールの説明が出る。
 * チップのタップはルールの切り替えなので、タッチの端末向けに説明の一覧を <details> に畳んで添える
 */
export function RuleChips({ ruleIds, onToggle, swap = false, onSwap }: Props) {
  const { id: tipId, tip, bind } = useHoverTip();
  // スワップはエンジンに効かないので、エンジンのルールとは別のブロックに置く
  const helpIds = onSwap ? [...ALL_IDS, RULE_ID.swap] : ALL_IDS;
  return (
    <div className="rule-picker" role="group" aria-label="有効なルール">
      <div className="chips">
        {TOGGLES.map((id) => (
          <button type="button" key={id} className={`chip${ruleIds.includes(id) ? ' chip-on' : ''}`} aria-pressed={ruleIds.includes(id)} onClick={() => onToggle(id)} {...bind(String(id), RULE_HELP[id])}>
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
                  {...bind(`none-${g.label}`, g.noneHelp)}
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
                    {...bind(String(id), RULE_HELP[id])}
                  >
                    {g.short[id]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {onSwap && (
        <div className="rule-group rule-group-pre">
          <span className="rule-group-label">対戦前</span>
          <div className="chips">
            <button type="button" className={`chip${swap ? ' chip-on' : ''}`} aria-pressed={swap} onClick={() => onSwap(!swap)} {...bind(String(RULE_ID.swap), RULE_HELP[RULE_ID.swap])}>
              {RULE_NAMES[RULE_ID.swap]}
            </button>
          </div>
          <p className="note rule-group-note">対戦が始まる時に 1 枚交換されます。デッキの評価に反映します(交換された 2 枚は、対局画面の「スワップ」で入れてください)。</p>
        </div>
      )}
      <details className="rule-help">
        <summary>ルールの説明</summary>
        <dl>
          {helpIds.map((id) => (
            <div key={id} className="rule-help-row">
              <dt>{RULE_NAMES[id]}</dt>
              <dd>{RULE_HELP[id]}</dd>
            </div>
          ))}
        </dl>
      </details>
      {/* ダイアログ(ルールを変更)の中でも最上位レイヤーに乗るよう、吹き出しはこの中に描く */}
      {tip && <Tip id={tipId} anchor={tip.anchor}>{tip.text}</Tip>}
    </div>
  );
}
