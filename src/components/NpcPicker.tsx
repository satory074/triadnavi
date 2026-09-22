import { useState } from 'react';
import { PRE_MATCH_RULE_IDS, RULE_NAMES } from '../core/rules';
import { npcById, searchNpcs, type NpcInfo } from '../data';
import { ConfirmAction } from './ConfirmAction';

interface Props {
  npcId: number | null;
  onPick: (npc: NpcInfo) => void;
  onClear: () => void;
}

/**
 * NPC の選択。「変更」は今の NPC を残したまま検索欄を出し、選んだ時点で丸ごと置き換える(applyNpc)。
 * 外すのは別のボタンで、ルールと相手の手札も消えるので 2 段階の確認にする(以前は「変更」で即座に全部消えていた)
 */
export function NpcPicker({ npcId, onPick, onClear }: Props) {
  const [query, setQuery] = useState('');
  const [changing, setChanging] = useState(false);
  const npc = npcId === null ? undefined : npcById(npcId);

  const pick = (n: NpcInfo) => {
    onPick(n);
    setQuery('');
    setChanging(false);
  };

  const results = searchNpcs(query, query ? 30 : 8);
  const search = (
    <div className="npc-picker">
      <label className="field-label" htmlFor="npc-search">NPC の名前か場所</label>
      <input
        id="npc-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="例: メメルン、ゴールドソーサー"
        autoComplete="off"
      />
      <ul className="result-list">
        {results.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => pick(n)}>
              <span className="result-name">{n.name}</span>
              <span className="result-sides">{n.location}</span>
              <span className="result-type">{n.rules.map((r) => RULE_NAMES[r]).join('、') || 'ルールなし'}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="muted result-empty">見つかりません。対人戦などは、選ばずにそのまま進めます。</li>}
      </ul>
    </div>
  );

  if (!npc) return search;

  const pre = npc.rules.filter((r) => PRE_MATCH_RULE_IDS.includes(r));
  return (
    <div className="npc-selected">
      <div className="npc-line">
        <strong>{npc.name}</strong>
        <span className="muted">{npc.location}</span>
        {changing ? (
          <button type="button" className="btn-tertiary btn-sm" onClick={() => setChanging(false)}>やめる</button>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setChanging(true)}>変更</button>
        )}
        <ConfirmAction className="btn-tertiary btn-sm" small label="外す" confirmLabel="外す(ルールと相手の手札も消えます)" onConfirm={onClear} aria-label="NPC を外す" />
      </div>
      {changing && search}
      <p className="note">
        固定カード {npc.fixed.length} 枚は必ず手札に入り、残り {5 - npc.fixed.length} 枚は候補 {npc.variable.length} 枚の中から選ばれます。
      </p>
      {pre.length > 0 && (
        <p className="note note-warn">
          この NPC には「{pre.map((r) => RULE_NAMES[r]).join('」「')}」があります。対戦が始まってから、実際に決まったルールと手札を入れてください。
        </p>
      )}
      {npc.usesRegional && <p className="note note-warn">流行ルールが適用される NPC です。今日の流行ルールも下で追加してください。</p>}
    </div>
  );
}
