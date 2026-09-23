import { entryOutcome, rematchCount, type HistoryEntry, type HistoryMeta } from '../core/history';
import { RULE_ID, RULE_NAMES, ruleIdsOf } from '../core/rules';
import { formatSide, type CardDef } from '../core/types';
import { cardById, competitionById, npcById, openRulesetById, openRulesetLabel, resolveCardIds } from './index';

/** 対戦記録の表示用の文言と書き出し。同梱データ(大会名、NPC 名、カード名)を引くので data 層に置く(core は data を import しない) */

const KIND_LABEL: Record<HistoryMeta['mode'], string> = { tournament: '大会', open: 'オフィシャルトーナメント' };

/** 大会名か、オフィシャルトーナメントのルールの組(「ベーシック(ドラフトのみ)」など) */
export function historyName(m: HistoryMeta): string {
  if (m.mode === 'tournament') return competitionById(m.tournamentId)?.name ?? '不明な大会';
  const r = openRulesetById(m.openRulesetId);
  return r ? openRulesetLabel(r) : 'ドラフト';
}

/** 対局画面の見出し(matchTitle)と同じ文言: 「大会: マンダヴィル・チャンピオンシップ」 */
export function historyTitle(m: HistoryMeta): string {
  return `${KIND_LABEL[m.mode]}: ${historyName(m)}`;
}

/** 相手。NPC なら名前、大会のプレイヤーは「プレイヤー」、ドラフトは「ドラフトの相手」 */
export function opponentLabel(e: HistoryEntry): string {
  const npcId = e.games[0]?.setup.npcId;
  const npc = npcId === undefined ? undefined : npcById(npcId);
  return npc?.name ?? (e.mode === 'open' ? 'ドラフトの相手' : 'プレイヤー');
}

/** カードの名前。名前が無ければ数字から引き(同じ数字のカードが複数ある 9 組は先頭の 1 枚)、それも無ければ数字 */
export function cardName(c: CardDef): string {
  if (c.label) return c.label;
  const id = resolveCardIds(c)[0];
  return (id === undefined ? undefined : cardById(id)?.name) ?? c.sides.map(formatSide).join('/');
}

/** 対戦前に決まっていたルール(ルーレット / スワップ / ドラフト)+ 対局のルール(最後の対局の setup.rules。対局中の変更を反映)。重複なし */
export function entryRuleIds(e: HistoryEntry): number[] {
  const pre = e.mode === 'tournament' ? (competitionById(e.tournamentId)?.rules ?? []) : (openRulesetById(e.openRulesetId)?.rules ?? [RULE_ID.draft]);
  const fixed = pre.filter((id) => id === RULE_ID.roulette || id === RULE_ID.swap || id === RULE_ID.draft);
  const last = e.games[e.games.length - 1];
  const out: number[] = [];
  for (const id of [...fixed, ...ruleIdsOf(last.setup.rules)]) if (!out.includes(id)) out.push(id);
  return out;
}

const OUTCOME_TEXT = { win: '勝ち', draw: '引き分け', loss: '負け' } as const;

/** 「勝ち 6 対 4」/「未完」 */
export function resultText(e: HistoryEntry): string {
  const last = e.games[e.games.length - 1];
  const outcome = entryOutcome(e);
  if (!outcome || !last?.score) return '未完';
  return `${OUTCOME_TEXT[outcome]} ${last.score.me} 対 ${last.score.opp}`;
}

/** ローカル時刻の 'YYYY-MM-DD HH:mm' */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 書き出しは保存データそのまま。games[i].setup + events を replay に渡せば盤面を再生できる */
export function historyJson(entries: readonly HistoryEntry[], exportedAt: number): string {
  return JSON.stringify({ version: 1, exportedAt: new Date(exportedAt).toISOString(), entries });
}

export const TSV_COLUMNS = ['日時', '種類', '大会', '相手', 'ルール', 'カード1', 'カード2', 'カード3', 'カード4', 'カード5', '先攻', '結果', '自分の枚数', '相手の枚数', 'サドンデス回数', '完了'] as const;

/** 表計算向け。見出し 1 行 + 1 行 1 対戦(新しい順)。欄の中のタブと改行は空白にする(カード名は手入力なので) */
export function historyTsv(entries: readonly HistoryEntry[]): string {
  const cell = (s: string | number) => String(s).replace(/[\t\r\n]+/g, ' ');
  const rows = [...entries].reverse().map((e) => {
    const first = e.games[0];
    const last = e.games[e.games.length - 1];
    const outcome = entryOutcome(e);
    const cards = Array.from({ length: 5 }, (_, i) => (first.setup.myHand[i] ? cardName(first.setup.myHand[i]) : ''));
    return [
      formatDateTime(e.startedAt),
      KIND_LABEL[e.mode],
      historyName(e),
      opponentLabel(e),
      entryRuleIds(e).map((id) => RULE_NAMES[id] ?? String(id)).join('、'),
      ...cards,
      first.setup.first === 0 ? '自分' : '相手',
      outcome ? OUTCOME_TEXT[outcome] : '未完',
      last.score?.me ?? '',
      last.score?.opp ?? '',
      rematchCount(e),
      outcome ? 'はい' : 'いいえ',
    ].map(cell).join('\t');
  });
  return [TSV_COLUMNS.join('\t'), ...rows].join('\n');
}
