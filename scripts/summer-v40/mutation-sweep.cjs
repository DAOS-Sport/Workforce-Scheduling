// Independent check of rule-coverage.cjs: for every rule marked implemented and every function or constant it names,
// break that symbol inside a test run and require the tests tagged with the rule to go red.
// Functions throw when called from a test; constants are replaced by a perturbed copy (every string, number and array element changes).
// Usage: node scripts/summer-v40/mutation-sweep.cjs [root] [R001,R002,...]
// root defaults to the repo root. The sweep rewrites client/src/lib/summer/*.ts while it runs and restores them in a finally block,
// so it refuses to start when those files have uncommitted changes. Run it in a throwaway copy if anything else is editing the tree.
// Exit code 1 when any symbol stays green, the baseline for a rule is red or empty, or vitest output cannot be read.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const LIB = path.join(ROOT, 'client/src/lib/summer');
const ts = require(path.join(ROOT, 'node_modules/typescript'));
const map = require(path.join(ROOT, 'scripts/summer-v40/rule-coverage.cjs'));

const dirty = cp.spawnSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'client/src/lib/summer'], { encoding: 'utf8' });
if (dirty.status === 0 && dirty.stdout.trim()) {
  console.error('refusing to run: uncommitted changes under client/src/lib/summer\n' + dirty.stdout);
  process.exit(2);
}

const files = fs.readdirSync(LIB).filter(f => f.endsWith('.ts'));
const orig = {};
const loc = {};
for (const f of files) {
  const text = fs.readFileSync(path.join(LIB, f), 'utf8');
  orig[f] = text;
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ES2020, true);
  const exported = n => n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  sf.forEachChild(n => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body && exported(n)) loc[n.name.text] = { file: f, kind: 'fn', pos: n.body.getStart() + 1 };
    if (!ts.isVariableStatement(n) || !exported(n)) return;
    for (const d of n.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const init = d.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        if (ts.isBlock(init.body)) loc[d.name.text] = { file: f, kind: 'fn', pos: init.body.getStart() + 1 };
        else loc[d.name.text] = { file: f, kind: 'expr', start: init.body.getStart(), end: init.body.getEnd() };
      } else loc[d.name.text] = { file: f, kind: 'const', start: init.getStart(), end: init.getEnd() };
    }
  });
}

const IN_TEST = 'globalThis.expect && globalThis.expect.getState().currentTestName';
const PERTURB =
  '((v) => { const m = x => typeof x === "string" ? x + "~" : typeof x === "number" ? x + 1 : Array.isArray(x) ? x.map(m) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, m(y)])) : x; return m(v); })';

function mutate(name) {
  const l = loc[name];
  if (!l) return false;
  const t = orig[l.file];
  let out;
  if (l.kind === 'fn') out = t.slice(0, l.pos) + ` if (${IN_TEST}) throw new Error("MUT"); ` + t.slice(l.pos);
  else if (l.kind === 'expr') out = t.slice(0, l.start) + `((${IN_TEST}) ? (() => { throw new Error("MUT"); })() : ${t.slice(l.start, l.end)})` + t.slice(l.end);
  else out = t.slice(0, l.start) + `${PERTURB}(${t.slice(l.start, l.end)})` + t.slice(l.end);
  fs.writeFileSync(path.join(LIB, l.file), out);
  return true;
}
const restore = () => files.forEach(f => fs.writeFileSync(path.join(LIB, f), orig[f]));

const tokens = new Set();
const TD = path.join(LIB, '__tests__');
for (const f of fs.readdirSync(TD).filter(x => /\.test\.ts$/.test(x))) {
  for (const m of fs.readFileSync(path.join(TD, f), 'utf8').matchAll(/R\d{3}(?:-R?\d{3})?/g)) tokens.add(m[0]);
}
function tagsCovering(rid) {
  const n = Number(rid.slice(1));
  return [...tokens].filter(tk => {
    const m = tk.match(/R(\d{3})(?:-R?(\d{3}))?/);
    return n >= Number(m[1]) && n <= Number(m[2] || m[1]);
  });
}

function runTagged(rid) {
  const tags = tagsCovering(rid);
  if (!tags.length) return { passed: 0, failed: 0, failedSuites: 0 };
  const r = cp.spawnSync('npx', ['vitest', 'run', 'client/src/lib/summer', '-t', `"(${tags.join('|')})"`, '--reporter=json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, DATABASE_URL: 'postgres://snap:snap@127.0.0.1:1/none' },
    maxBuffer: 1 << 28,
  });
  try {
    const o = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1));
    return { passed: o.numPassedTests, failed: o.numFailedTests, failedSuites: o.numFailedTestSuites };
  } catch {
    return { error: (r.stderr || r.stdout).slice(0, 300) };
  }
}

const tally = {};
let bad = 0;
const note = (verdict, text) => {
  tally[verdict] = (tally[verdict] || 0) + 1;
  if (verdict !== 'RED') bad++;
  console.log(`${verdict} ${text}`);
};
try {
  for (const [rid, e] of Object.entries(map)) {
    if (e.status !== 'impl' || (only && !only.has(rid))) continue;
    const base = runTagged(rid);
    if (base.error || base.failed || base.failedSuites || !base.passed) {
      note('BASELINE', `${rid} ${JSON.stringify(base)}`);
      continue;
    }
    for (const name of e.fns) {
      if (!mutate(name)) {
        note('MISSING', `${rid} ${name} is not an exported function or constant`);
        continue;
      }
      const r = runTagged(rid);
      restore();
      if (r.error) note('ERROR', `${rid} ${name} ${r.error}`);
      else if (r.failed > 0 || r.failedSuites > 0) note('RED', `${rid} ${name} (${base.passed} tagged tests, ${r.failed} failed when broken)`);
      else note('GREEN', `${rid} ${name}: tests tagged ${rid} do not depend on it (${base.passed} tagged tests)`);
    }
  }
} finally {
  restore();
}
console.log(`sweep done ${JSON.stringify(tally)}`);
process.exit(bad ? 1 : 0);
