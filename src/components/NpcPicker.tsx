import { useState } from 'react';
import { PRE_MATCH_RULE_IDS, RULE_NAMES } from '../core/rules';
import { npcById, searchNpcs, type NpcInfo } from '../data';

interface Props {
  npcId: number | null;
  onPick: (npc: NpcInfo) => void;
  onClear: () => void;
}

export function NpcPicker({ npcId, onPick, onClear }: Props) {
  const [query, setQuery] = useState('');
  const npc = npcId === null ? undefined : npcById(npcId);

  if (npc) {
    const pre = npc.rules.filter((r) => PRE_MATCH_RULE_IDS.includes(r));
    return (
      <div className="npc-selected">
        <div className="npc-line">
          <strong>{npc.name}</strong>
          <span className="muted">{npc.location}</span>
          <button type="button" className="btn btn-sm" onClick={onClear}>変更</button>
        </div>
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

  const results = searchNpcs(query, query ? 30 : 8);
  return (
    <div className="npc-picker">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="NPC の名前か場所(例: メメルン、ゴールドソーサー)"
        aria-label="NPC を探す"
        autoComplete="off"
      />
      <ul className="result-list">
        {results.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => onPick(n)}>
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
}
