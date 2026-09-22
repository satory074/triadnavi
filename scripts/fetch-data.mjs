// カード/NPC データの更新スクリプト。`npm run data:update` で手動実行し、生成された JSON をコミットする。
// CI では実行しない(第三者 API の停止でデプロイが壊れないようにするため)。1 回の更新は GET 4 回。
//
// 取得元:
//   FFXIV Collect  … カードの日本語名・四辺の数字・タイプ・レアリティ・ゲーム内リストの並び・入手方法、
//                    NPC の日本語名・場所・座標、トライアドパックの中身と値段
//   XIVAPI v2      … NPC のデッキ(固定/可変)・固定ルール・流行ルール適用フラグ(ゲームデータそのもの)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const CARDS_URL = 'https://ffxivcollect.com/api/triad/cards?language=ja';
const NPCS_URL = 'https://ffxivcollect.com/api/triad/npcs?language=ja';
const PACKS_URL = 'https://ffxivcollect.com/api/triad/packs?language=ja';
const DECKS_URL =
  'https://v2.xivapi.com/api/sheet/TripleTriad?limit=500&fields=' +
  'TripleTriadCardFixed@as(raw),TripleTriadCardVariable@as(raw),TripleTriadRule@as(raw),UsesRegionalRules';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'triadnavi data updater (github.com/satory074/triadnavi)' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

const nonZero = (xs) => xs.filter((x) => x > 0);

const [cardsRaw, npcsRaw, decksRaw, packsRaw] = await Promise.all([
  getJson(CARDS_URL), getJson(NPCS_URL), getJson(DECKS_URL), getJson(PACKS_URL),
]);

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

// ---- 入手方法 ----
// FFXIV Collect の入手方法は、日本語を指定しても分類名と一部の文章(FATE のジェム交換、エウレカ、ディープダンジョンなど)が英語のまま返る。
// 文章は自由記述で、毎回自動で訳すと壊れやすいので、英語の原文 → 日本語の表(source-ja.json)を手で作って置き換える。
// 名前はゲームデータ(XIVAPI)の日本語名を英語名で引いて使った。表に無い英語は英語のまま残して警告する(更新は止めない)
const SOURCE_JA = JSON.parse(await readFile(new URL('./source-ja.json', import.meta.url), 'utf8'));
const KIND_JA = {
  NPC: 'NPC 対戦',
  Dungeon: 'ダンジョン',
  Trial: '討滅戦',
  Raid: 'レイド',
  'V&C Dungeon': 'ヴァリアント/アナザー',
  Achievement: 'アチーブメント',
  Quest: 'クエスト',
  FATE: 'FATE',
  Eureka: 'エウレカ',
  'Deep Dungeon': 'ディープダンジョン',
  Tribal: '友好部族',
  Hunts: 'モブハント',
  Bozja: 'ボズヤ',
  Skybuilders: '蒼天街',
  'Island Sanctuary': '無人島',
  Event: 'イベント',
  PvP: 'PvP',
};
const hasJa = (s) => /[\u3040-\u30ff\u3400-\u9fff]/.test(s);
const npcPlace = new Map(
  npcsRaw.results.map((n) => {
    const l = n.location;
    return [n.id, l ? `${l.name}${l.x && l.y ? ` X:${l.x} Y:${l.y}` : ''}` : ''];
  }),
);

// パックはカードの入手方法に「Dream Triad Card」としか書かれていないので、パックの API の名前と値段に置き換える
const packsOf = new Map();
for (const p of packsRaw.results) {
  // 値段 0 は売っていないパック(プラチナ。大会の入賞賞品)
  const entry = { kind: 'パック', text: p.name, where: p.cost > 0 ? `${p.cost.toLocaleString('en-US')} MGP(カードトレーダー)` : '大会の賞品' };
  for (const c of p.cards) {
    if (!cardIds.has(c.id)) throw new Error(`パック ${p.name} が未知のカード ${c.id} を含んでいます`);
    packsOf.set(c.id, [...(packsOf.get(c.id) ?? []), entry]);
  }
}

const MGP_RE = /^([\d,]+) (?:MGP|マンダヴィル・ゴールドソーサーポイント)$/;
const sources = cardsRaw.results
  .map((c) => {
    const out = [];
    let packed = false;
    for (const s of c.sources ?? []) {
      if (s.type === 'Gold Saucer') {
        const mgp = s.text.match(MGP_RE);
        if (mgp) {
          out.push({ kind: 'MGP 交換', text: `${mgp[1]} MGP`, where: 'ゴールドソーサー カードトレーダー' });
          continue;
        }
        if (/Triad Card$/.test(s.text)) {
          if (!packsOf.has(c.id)) warnings.push(`カード ${c.id} ${c.name}: 「${s.text}」とあるが、どのパックにも入っていません`);
          else if (!packed) out.push(...packsOf.get(c.id));
          packed = true;
          continue;
        }
        if (s.text === 'Triple Triad Tournament') {
          out.push({ kind: '大会', text: 'トリプルトライアド大会の賞品', where: 'ゴールドソーサー' });
          continue;
        }
      }
      const kind = KIND_JA[s.type] ?? s.type;
      if (!(s.type in KIND_JA) && !hasJa(s.type)) warnings.push(`カード ${c.id} ${c.name}: 分類「${s.type}」の日本語名がありません(KIND_JA に足す)`);
      if (s.type === 'NPC') {
        out.push({ kind, text: s.text, where: npcPlace.get(s.related_id) || undefined });
        continue;
      }
      const ja = SOURCE_JA[s.text];
      if (ja) out.push({ kind, ...ja });
      else {
        if (!hasJa(s.text)) warnings.push(`カード ${c.id} ${c.name}: 「${s.text}」の訳がありません(source-ja.json に足す)`);
        out.push({ kind, text: s.text });
      }
    }
    if (packsOf.has(c.id) && !packed) {
      warnings.push(`カード ${c.id} ${c.name}: パックに入っているが、入手方法にパックの記載がありません(パックを足しました)`);
      out.push(...packsOf.get(c.id));
    }
    // 同じ入手方法が 2 回書かれていたら 1 つにする
    const seen = new Set();
    const uniq = out.filter((x) => {
      const k = `${x.kind}|${x.text}|${x.where ?? ''}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    if (uniq.length === 0) warnings.push(`カード ${c.id} ${c.name}: 入手方法がありません`);
    return { id: c.id, sources: uniq };
  })
  .sort((a, b) => a.id - b.id);

await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
// 1 行 1 件にして、更新時の差分を読みやすくする
const lines = (rows) => '[\n' + rows.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n';
await writeFile(new URL('../src/data/cards.json', import.meta.url), lines(cards));
await writeFile(new URL('../src/data/npcs.json', import.meta.url), lines(npcs));
await writeFile(new URL('../src/data/sources.json', import.meta.url), lines(sources));

for (const w of warnings) console.warn('警告:', w);
console.log(`カード ${cards.length} 枚、NPC ${npcs.length} 人、入手方法 ${sources.reduce((n, x) => n + x.sources.length, 0)} 件を書き出しました(警告 ${warnings.length} 件)`);
