// カード/NPC データの更新スクリプト。`npm run data:update` で手動実行し、生成された JSON をコミットする。
// CI では実行しない(第三者 API の停止でデプロイが壊れないようにするため)。1 回の更新は GET 3 回。
//
// 取得元:
//   FFXIV Collect  … カードの日本語名・四辺の数字・タイプ・レアリティ・ゲーム内リストの並び、NPC の日本語名・場所
//   XIVAPI v2      … NPC のデッキ(固定/可変)・固定ルール・流行ルール適用フラグ(ゲームデータそのもの)
import { writeFile, mkdir } from 'node:fs/promises';

const CARDS_URL = 'https://ffxivcollect.com/api/triad/cards?language=ja';
const NPCS_URL = 'https://ffxivcollect.com/api/triad/npcs?language=ja';
const DECKS_URL =
  'https://v2.xivapi.com/api/sheet/TripleTriad?limit=500&fields=' +
  'TripleTriadCardFixed@as(raw),TripleTriadCardVariable@as(raw),TripleTriadRule@as(raw),UsesRegionalRules';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'triadnavi data updater (github.com/satory074/triadnavi)' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

const nonZero = (xs) => xs.filter((x) => x > 0);

const [cardsRaw, npcsRaw, decksRaw] = await Promise.all([getJson(CARDS_URL), getJson(NPCS_URL), getJson(DECKS_URL)]);

const cards = cardsRaw.results
  .map((c) => {
    const s = c.stats.numeric;
    // order / ex はゲーム内カードリストの並び(No. 1〜 と Ex. 1〜)。id 順とは一致しない
    return {
      id: c.id,
      name: c.name,
      sides: [s.top, s.right, s.bottom, s.left],
      type: c.type.id,
      stars: c.stars,
      order: c.order,
      ex: c.order_group !== 0,
    };
  })
  .sort((a, b) => a.id - b.id);

for (const c of cards) {
  const ok = c.sides.every((v) => Number.isInteger(v) && v >= 1 && v <= 10) && c.type >= 0 && c.type <= 4;
  if (!ok) throw new Error(`カード ${c.id} ${c.name} の値が想定外です: ${JSON.stringify(c)}`);
  if (!Number.isInteger(c.stars) || c.stars < 1 || c.stars > 5) throw new Error(`カード ${c.id} ${c.name} のレアリティが想定外です: ${c.stars}`);
  if (!Number.isInteger(c.order) || c.order < 1) throw new Error(`カード ${c.id} ${c.name} の並び順が想定外です: ${c.order}`);
}
const orderKeys = new Set(cards.map((c) => `${c.ex}:${c.order}`));
if (orderKeys.size !== cards.length) throw new Error('カードリストの並び順(ex, order)が重複しています');
const cardIds = new Set(cards.map((c) => c.id));

const decks = new Map(decksRaw.rows.map((r) => [r.row_id, r.fields]));
const warnings = [];
const npcs = [];
for (const n of npcsRaw.results) {
  const d = decks.get(n.id);
  if (!d) {
    warnings.push(`NPC ${n.id} ${n.name}: XIVAPI にデッキがありません(スキップ)`);
    continue;
  }
  const fixed = nonZero(d['TripleTriadCardFixed@as(raw)']);
  const variable = nonZero(d['TripleTriadCardVariable@as(raw)']);
  const rules = nonZero(d['TripleTriadRule@as(raw)']);
  const missing = [...fixed, ...variable].filter((id) => !cardIds.has(id));
  if (missing.length) throw new Error(`NPC ${n.id} ${n.name} が未知のカード ${missing} を参照しています`);
  // ルールはゲームデータ由来の XIVAPI を正とする。食い違いは警告として出す
  const collectRules = [...(n.rule_ids ?? [])].sort((a, b) => a - b);
  if (JSON.stringify([...rules].sort((a, b) => a - b)) !== JSON.stringify(collectRules)) {
    warnings.push(`NPC ${n.id} ${n.name}: ルールが食い違っています XIVAPI=${JSON.stringify(rules)} FFXIV Collect=${JSON.stringify(collectRules)}`);
  }
  npcs.push({
    id: n.id,
    name: n.name,
    location: n.location?.name ?? '',
    region: n.location?.region ?? '',
    fixed,
    variable,
    rules,
    usesRegional: Boolean(d.UsesRegionalRules),
  });
}
npcs.sort((a, b) => a.id - b.id);

await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
// 1 行 1 件にして、更新時の差分を読みやすくする
const lines = (rows) => '[\n' + rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n';
await writeFile(new URL('../src/data/cards.json', import.meta.url), lines(cards));
await writeFile(new URL('../src/data/npcs.json', import.meta.url), lines(npcs));

for (const w of warnings) console.warn('警告:', w);
console.log(`カード ${cards.length} 枚、NPC ${npcs.length} 人を書き出しました(警告 ${warnings.length} 件)`);
