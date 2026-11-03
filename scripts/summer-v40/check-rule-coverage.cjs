// Checks that every R rule in the contract is implemented and tested, deleted with a reason, or assigned to a later batch.
// Usage: node scripts/summer-v40/check-rule-coverage.cjs [path/to/覆蓋表.md]
// Writes scripts/summer-v40/rule-coverage.md and exits 1 on any gap.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LIB = path.join(ROOT, 'client/src/lib/summer');
const CONTRACT = process.argv[2] || 'D:/工作內容/駿斯/03-outputs/workforce-issues-arch-20261022/v40/覆蓋表.md';
const MAP = require('./rule-coverage.cjs');

const contract = fs.readFileSync(CONTRACT, 'utf8');
const ruleIds = [...contract.matchAll(/^\| (R\d{3}) \|/gm)].map(m => m[1]);
const s23Row = contract.split('\n').find(l => l.startsWith('| S23 |'));
if (!s23Row) throw new Error('S23 row not found in contract');
const s23 = new Set(s23Row.match(/R\d{3}/g));

const expand = text => {
  const out = new Set();
  for (const m of text.matchAll(/R(\d{3})(?:-R?(\d{3}))?/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = a; n <= b; n++) out.add(`R${String(n).padStart(3, '0')}`);
  }
  return out;
};

const sources = fs.readdirSync(LIB).filter(f => f.endsWith('.ts'));
const exported = new Set(sources.flatMap(f => [...fs.readFileSync(path.join(LIB, f), 'utf8').matchAll(/export (?:function|const|interface|type) (\w+)/g)].map(m => m[1])));

const STRING_LITERAL = /(['`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const testDir = path.join(LIB, '__tests__');
const testsByRule = new Map();
const divergences = [];
for (const f of fs.readdirSync(testDir).filter(x => x.endsWith('.test.ts'))) {
  const src = fs.readFileSync(path.join(testDir, f), 'utf8');
  for (const m of src.matchAll(STRING_LITERAL)) {
    const before = src.slice(0, m.index).trimEnd();
    const isTitle = before.endsWith('(') && !before.slice(0, -1).trimEnd().endsWith('describe');
    const title = m[2];
    if (!isTitle || !/R\d{3}/.test(title)) continue;
    for (const id of expand(title)) testsByRule.set(id, new Set([...(testsByRule.get(id) || []), f]));
    if (title.includes('與 v40 不同')) divergences.push({ file: f, title, ids: [...expand(title)] });
  }
}

const fail = [];
const missing = ruleIds.filter(id => !MAP[id]);
const extra = Object.keys(MAP).filter(id => !ruleIds.includes(id));
if (missing.length) fail.push(`rules without a coverage entry: ${missing.join(', ')}`);
if (extra.length) fail.push(`coverage entries not in the contract: ${extra.join(', ')}`);

const rows = [];
for (const id of ruleIds) {
  const e = MAP[id];
  if (!e) continue;
  if (e.status === 'impl') {
    const absent = e.fns.filter(fn => !exported.has(fn));
    if (absent.length) fail.push(`${id}: not exported from client/src/lib/summer: ${absent.join(', ')}`);
    const tests = [...(testsByRule.get(id) || [])];
    if (!tests.length) fail.push(`${id}: implemented but no test title names it`);
    rows.push(`| ${id} | 已實作 | ${e.fns.map(f => '`' + f + '`').join('、')} | ${tests.join('、')} |`);
  } else if (e.status === 'del') {
    if (!e.reason) fail.push(`${id}: deleted without a reason`);
    rows.push(`| ${id} | 刪除 | ${e.reason} | |`);
  } else {
    rows.push(`| ${id} | 待後續批 ${e.batch} | ${e.reason} | |`);
  }
}

for (const d of divergences) {
  if (!d.ids.some(id => s23.has(id))) fail.push(`"${d.title}" (${d.file}) cites no S23 rule`);
}
const divergedIds = new Set(divergences.flatMap(d => d.ids));
for (const id of s23) {
  if (MAP[id]?.status === 'impl' && !divergedIds.has(id)) fail.push(`${id}: S23 fix implemented but no 「與 v40 不同」 test names it`);
}

const count = s => ruleIds.filter(id => MAP[id]?.status === s).length;
const summary = `規則 ${ruleIds.length} 條：已實作 ${count('impl')}、刪除 ${count('del')}、待後續批 ${count('later')}。與 v40 不同的測試 ${divergences.length} 個，涵蓋 S23 ${[...divergedIds].filter(id => s23.has(id)).sort().join('、')}。`;
const md = [
  '# 暑假排班 v40 規則覆蓋對照',
  '',
  '由 `node scripts/summer-v40/check-rule-coverage.cjs` 產生，不要手改。資料來源是 `rule-coverage.cjs` 與 `client/src/lib/summer/__tests__` 的測試名稱。',
  '',
  summary,
  '',
  '## 與 v40 不同的行為',
  '',
  ...divergences.map(d => `- ${d.title}（${d.file}）`),
  '',
  '## 逐條對照',
  '',
  '| 規則 | 狀態 | 函式／理由 | 測試檔 |',
  '|---|---|---|---|',
  ...rows,
  '',
].join('\n');
fs.writeFileSync(path.join(__dirname, 'rule-coverage.md'), md);
console.log(summary);
if (fail.length) {
  console.error(fail.map(f => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
console.log('PASS');
