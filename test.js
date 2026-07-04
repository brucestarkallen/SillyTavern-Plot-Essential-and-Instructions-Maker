// Load + engine tests for Lore Agent. Run: node test.js
global.SillyTavern = { getContext() { return {}; } };
require('./index.js');
const D = globalThis.__loreAgentDebug;
let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ok -', name); }
    else { fail++; console.log('  FAIL -', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

console.log('== load ==');
ok(!!D && D.VERSION, 'debug export present, v' + (D && D.VERSION));

console.log('== findBlock: prose-mention poisoning ==');
const poisoned = 'No <docedits> needed for the intro. Here you go:\n<docedits>\n[{"append": true, "replace": "hello", "reason": "r"}]\n</docedits>\ndone';
const b1 = D.findBlock(poisoned, 'docedits');
ok(b1 && b1.inner.trim().startsWith('['), 'picks the JSON-looking block, not the prose mention', b1 && b1.inner.slice(0, 40));
const proseOnly = 'I did not include a docedits block here, no <docedits> at all.';
ok(D.findBlock(proseOnly, 'docedits') === null, 'unclosed prose mention alone -> null');
const fenced = 'x <docedits>\n```json\n[{"find":"a","replace":"b","reason":"r"}]\n```\n</docedits>';
const pf = D.parseDocEdits(fenced);
ok(pf.edits.length === 1 && pf.edits[0].type === 'replace', 'markdown fences inside block are stripped', pf);

console.log('== parseDocEdits ==');
const all4 = '<docedits>[' +
    '{"find":"old text","replace":"new text","reason":"a"},' +
    '{"insert_after":"## Anchor","replace":"para","reason":"b"},' +
    '{"append":true,"replace":"tail","reason":"c"},' +
    '{"replace_all":true,"replace":"whole","reason":"d"}' +
    ']</docedits>';
const p4 = D.parseDocEdits(all4);
ok(p4.edits.length === 4 && p4.edits.map(e => e.type).join(',') === 'replace,insert,append,replace_all', 'all four op types parsed', p4.edits.map(e => e.type));
const trailing = '<docedits>[{"find":"a","replace":"b","reason":"r"},]</docedits>';
ok(D.parseDocEdits(trailing).edits.length === 1, 'trailing comma repaired');
const badJson = '<docedits>[{"find": broken}]</docedits>';
const pb = D.parseDocEdits(badJson);
ok(pb.edits.length === 0 && pb.error, 'invalid JSON -> harmless error note, no crash', pb.error);
ok(D.parseDocEdits('no block at all').edits.length === 0, 'no block -> empty edits');

console.log('== stripBlocks ==');
const stripped = D.stripBlocks(poisoned);
ok(stripped.includes('[proposed edits below]') && !stripped.includes('"append"'), 'block replaced with placeholder in display text');
ok(stripped.includes('No <docedits> needed'), 'prose mention untouched by stripping');

console.log('== splitThinking ==');
const st1 = D.splitThinking('<think>plan things</think>Answer here');
ok(st1.rest === 'Answer here' && st1.think === 'plan things', 'closed think tag split');
const st2 = D.splitThinking('partial <reasoning>still going');
ok(st2.rest === 'partial' && st2.think === 'still going', 'unclosed tag mid-stream treated as thinking', st2);

console.log('== locate ==');
const hayS = 'alpha beta gamma. alpha beta gamma. delta.';
const l1 = D.locate(hayS, 'alpha beta gamma.');
ok(l1 && l1.start === 0 && l1.count === 2, 'exact match + occurrence count', l1);
const l2 = D.locate('She said \u201Chello there\u201D and left \u2014 fast.', 'She said "hello there" and left - fast.');
ok(l2 && !l2.fuzzy, 'curly quotes / em dash normalized match', l2);

// Big-doc fuzzy: ~30k chars, needle slightly misquoted.
let big = '# Mithraic Codex\n\n';
for (let i = 0; i < 300; i++) {
    big += 'Section ' + i + ': The wardens of house ' + (i % 7) + ' keep the ' + (i % 5) + 'th gate sealed through winter, and the levy of grain moves by barge along the ' + (i % 3) + ' canal before the frost takes the locks.\n';
}
const target = 'The blood-cost of a casting is measured in drachms drawn from the caster, and no adept below the third circle may spend more than two drachms in a single working without a warden countersigning the rite.';
big += '\n## Magic System\n' + target + '\n\n';
for (let i = 0; i < 200; i++) {
    big += 'Appendix ' + i + ': tithes, censuses and the register of oaths are archived beneath the summer library where the ' + (i % 4) + ' clerks rotate by season.\n';
}
const misquoted = 'The blood cost of a casting is measured in drachms taken from the caster, and no adept below the third circle may spend more than two drachms in one working without a warden countersigning the rite.';
const t0 = Date.now();
const lf = D.locate(big, misquoted);
const ms = Date.now() - t0;
ok(lf && lf.fuzzy && lf.sim >= 0.78, 'fuzzy match survives misquote on ' + big.length + '-char doc (sim=' + (lf && lf.sim && lf.sim.toFixed(2)) + ')', lf);
ok(lf && big.slice(lf.start, lf.end).includes('drachms drawn from the caster'), 'fuzzy range covers the real paragraph');
ok(ms < 1500, 'fuzzy locate fast enough (' + ms + 'ms)');
ok(D.locate(big, 'completely absent gibberish qqq zzz www xxx yyy') === null, 'absent text -> null, no false positive');

console.log('== applyEditToText ==');
const doc1 = '# Title\n\n## Magic\nFire only.\n\n## Cast\nNobody yet.\n';
const r1 = D.applyEditToText(doc1, { type: 'replace', find: 'Fire only.', replace: 'Blood-cost casting.', reason: '' });
ok(r1.ok && r1.text.includes('Blood-cost casting.') && !r1.text.includes('Fire only.'), 'surgical replace');
const r2 = D.applyEditToText(doc1, { type: 'insert', find: '## Cast', replace: '### Jorin\nA warden.', replace_all: false });
ok(r2.ok && /## Cast\n### Jorin\nA warden\.\nNobody yet\./.test(r2.text), 'insert_after lands on a new line under the anchor line', r2.text);
const r3 = D.applyEditToText('', { type: 'append', replace: '# Fresh doc' });
ok(r3.ok && r3.text === '# Fresh doc\n', 'append to empty document');
const r4 = D.applyEditToText('body\n', { type: 'append', replace: 'tail' });
ok(r4.ok && r4.text === 'body\n\ntail\n', 'append separates with a blank line', JSON.stringify(r4.text));
const r5 = D.applyEditToText(doc1, { type: 'replace_all', replace: 'X' });
ok(r5.ok && r5.text === 'X', 'replace_all');
const r6 = D.applyEditToText(doc1, { type: 'replace', find: 'not present anywhere at all', replace: 'x' });
ok(!r6.ok && /not located/.test(r6.reason), 'missing find -> clean failure with hint', r6.reason);
const r7 = D.applyEditToText('a b a b', { type: 'replace', find: 'a b', replace: 'Z' });
ok(r7.ok && /1 of 2/.test(r7.note || ''), 'ambiguous exact match flagged (1 of N)', r7.note);

console.log('== grow (stream accumulator) ==');
ok(D.grow('', 'Hel') === 'Hel' && D.grow('Hel', 'Hello') === 'Hello' && D.grow('Hello', ' wor') === 'Hello wor', 'cumulative and delta chunks both accumulate');

// Let the 3s init-fallback timer fire under node to prove it cannot crash,
// then print the final tally and exit with the test status.
setTimeout(() => {
    console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
}, 3400);
// v0.2.0 additions
console.log('== mimeForName ==');
setTimeout(() => {
    ok(D.mimeForName('x.json').startsWith('application/json'), 'json mime');
    ok(D.mimeForName('x.yaml').startsWith('application/x-yaml') && D.mimeForName('x.yml').startsWith('application/x-yaml'), 'yaml mime');
    ok(D.mimeForName('noext').startsWith('text/markdown'), 'no extension defaults to markdown');
    ok(D.mimeForName('weird.zzz').startsWith('text/plain'), 'unknown extension falls back to text/plain');

    // v0.3.0 additions
    console.log('== doc-targeted edits ==');
    const pd = D.parseDocEdits('<docedits>[{"doc":"Y","find":"a","replace":"b","reason":"r"},{"find":"c","replace":"d","reason":"r"}]</docedits>');
    ok(pd.edits.length === 2 && pd.edits[0].docName === 'Y' && pd.edits[1].docName === null, 'doc field parsed, absent -> null (main doc)', pd.edits.map(e => e.docName));
    const pool = [{ name: 'X' }, { name: 'engine.yaml' }, { name: 'Engine v2.yaml' }];
    ok(D.resolveDocByName(pool, 'X') === pool[0], 'resolver: exact');
    ok(D.resolveDocByName(pool, 'ENGINE.YAML') === pool[1], 'resolver: case-insensitive');
    ok(D.resolveDocByName(pool, 'v2') === pool[2], 'resolver: unique partial');
    ok(D.resolveDocByName(pool, 'engine') === null, 'resolver: ambiguous partial -> null');
    ok(D.resolveDocByName(pool, 'missing') === null, 'resolver: unknown -> null');
}, 10);
