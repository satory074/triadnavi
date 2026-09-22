import type { SetupDraft } from '../core/appState';
import { PRE_MATCH_RULE_IDS, RULE_NAMES } from '../core/rules';
import { BATTLEHALL_NPCS, cardById, competitionById, npcById, COMPETITIONS, type CompetitionInfo, type NpcInfo } from '../data';
import { RuleNames } from './RuleNames';

interface Props {
  draft: SetupDraft;
  onPick: (t: CompetitionInfo) => void;
  onNpc: (npc: NpcInfo) => void;
  onPlayer: () => void;
}

/**
 * 大会(ランキング形式)の選択と、その相手(プレイヤー / カードバトルルームの NPC 5 人)。
 * 大会対戦は大会のルールで行われるので、NPC を選んでもルールは変わらない(applyNpc が大会モードでは残す)。
 * 勝ち点の計算式は公開されていない(プレイヤー戦 > NPC 戦、枚数差でも増える、としか分かっていない)ので、勝ち点は出さない
 */
export function TournamentPicker({ draft, onPick, onNpc, onPlayer }: Props) {
  const current = competitionById(draft.tournamentId);
  const npc = draft.npcId === null ? undefined : npcById(draft.npcId);
  const inHall = npc !== undefined && BATTLEHALL_NPCS.some((n) => n.id === npc.id);
  const pre = current?.rules.filter((r) => PRE_MATCH_RULE_IDS.includes(r)) ?? [];

  return (
    <div className="tournament-picker">
      <ul className="result-list" aria-label="大会">
        {COMPETITIONS.map((t) => (
          <li key={t.id}>
            <button type="button" aria-pressed={t.id === draft.tournamentId} onClick={() => onPick(t)}>
              <span className="result-name">{t.name}</span>
              <span className="result-note">入賞: {cardById(t.reward)?.name ?? ''}</span>
              {/* 行全体がボタンなので、ルール名のボタン(RuleNames)は入れ子にできない。説明は下の「この対戦のルール」で出る */}
              <span className="result-type">{t.rules.map((id) => RULE_NAMES[id]).join('、')}</span>
            </button>
          </li>
        ))}
      </ul>
      {current && pre.length > 0 && (
        <p className="note note-warn">
          この大会には <RuleNames ids={pre} /> があります。対戦が始まってから、実際に決まったルールと手札を入れてください。
        </p>
      )}

      <div className="tournament-opp">
        <span className="field-label">相手</span>
        <div className="segmented" role="group" aria-label="大会の相手">
          <button type="button" className={npc ? '' : 'seg-on'} aria-pressed={!npc} onClick={onPlayer}>プレイヤー(デッキ不明)</button>
          <button type="button" className={npc ? 'seg-on' : ''} aria-pressed={!!npc} onClick={() => { if (!npc) onNpc(BATTLEHALL_NPCS[0]); }}>バトルルームの NPC</button>
        </div>
      </div>
      {npc && (
        <ul className="result-list" aria-label="カードバトルルームの NPC">
          {BATTLEHALL_NPCS.map((n) => (
            <li key={n.id}>
              <button type="button" aria-pressed={n.id === npc.id} onClick={() => onNpc(n)}>
                <span className="result-name">{n.name}</span>
                <span className="result-sides">固定 {n.fixed.length} 枚 + 候補 {n.variable.length} 枚</span>
              </button>
            </li>
          ))}
          {!inHall && <li className="muted result-empty">{npc.name} はカードバトルルームの NPC ではありません。上の 5 人から選ぶか、プレイヤーにしてください。</li>}
        </ul>
      )}
      <p className="note">
        {npc
          ? '大会対戦は大会のルールで行われます(NPC 固有のルールは使いません。実機での確認は 1 例)。勝ち点はプレイヤー戦より少なく、NPC ごとに違います。'
          : 'オートマッチングの相手はデッキが分かりません。オールオープン/スリーオープンで見えたカードは、対局画面で開いてください。'}
      </p>
    </div>
  );
}
