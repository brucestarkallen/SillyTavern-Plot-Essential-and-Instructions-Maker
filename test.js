// Load + engine tests for Plot Essential and Instructions Maker (module id: loreAgent). Run: node test.js
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

    // v0.7.0: proposal accumulation (discuss-then-refine must not drop cards)
    console.log('== proposal accumulation ==');
    function simFreshReply(pending, newEdits, seq) {
        // mirrors the non-swipe branch of runGeneration
        if (newEdits.length) {
            seq.n++;
            for (const e of newEdits) e.batch = seq.n;
            pending = pending.concat(newEdits);
        }
        return pending;
    }
    const seq = { n: 0 };
    let pend = [];
    pend = simFreshReply(pend, [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }], seq);
    ok(pend.length === 2 && pend.every(e => e.batch === 1), 'first reply stages batch 1');
    // user discusses -> chat-only reply (no edits): cards must survive
    pend = simFreshReply(pend, [], seq);
    ok(pend.filter(e => e.status === 'pending').length === 2, 'chat-only reply keeps pending cards (THE BUG)');
    // refinement arrives -> stacks as batch 2
    pend = simFreshReply(pend, [{ id: 'c', status: 'pending' }], seq);
    ok(pend.length === 3 && pend.filter(e => e.batch === 2).length === 1, 'refinement stacks as batch 2, originals intact');
    const batches = [...new Set(pend.filter(e => e.status === 'pending').map(e => e.batch))];
    ok(batches.length === 2, 'two batches pending simultaneously for comparison', batches);
    // applying the newest batch only
    const mb = Math.max(...pend.map(e => e.batch));
    const newestOnly = pend.filter(e => e.batch === mb);
    ok(newestOnly.length === 1 && newestOnly[0].id === 'c', 'apply-newest selects only batch 2');

    // swipe replaces that reply's batch instead of stacking
    console.log('== swipe replaces, not stacks ==');
    function simSwipe(pending, idx, newEdits, seq) {
        pending = pending.filter(e => e.status !== 'pending' || e.fromSwipe !== idx);
        if (newEdits.length) {
            seq.n++;
            for (const e of newEdits) { e.batch = seq.n; e.fromSwipe = idx; }
            pending = pending.concat(newEdits);
        }
        return pending;
    }
    let sp = [{ id: 'x', status: 'pending', fromSwipe: 5, batch: 1 }];
    sp = simSwipe(sp, 5, [{ id: 'y', status: 'pending' }], seq);
    ok(sp.length === 1 && sp[0].id === 'y', 'swiping the same reply replaces its cards');

    // v0.8.0: worldbook engine
    console.log('== worldbook parse ==');
    const wbText = JSON.stringify([
        { name: 'Alexia Valois', keys: ['Alexia', 'Valois', 'Sunforge heir'], content: 'Heir to House Sunforge.', strategy: 'green', order: 100 },
        { name: 'The Standing', keys: 'Standing, Rank, ranking', content: 'Live earned position.', strategy: 'green' },
        { name: 'World spine', keys: [], content: 'Always-on fact.', strategy: 'blue' },
        { name: 'Deep lore', keys: [], content: 'Semantic only.', strategy: 'chain' },
    ]);
    const wp = D.parseWorldbook(wbText);
    ok(wp.entries.length === 4 && !wp.error, 'parses 4 entries');
    ok(wp.entries[1].keys.length === 3 && wp.entries[1].keys[0] === 'Standing', 'comma-string keys split to array', wp.entries[1].keys);
    ok(wp.entries[0].strategy === 'green' && wp.entries[2].strategy === 'blue' && wp.entries[3].strategy === 'chain', 'strategies preserved');
    ok(D.parseWorldbook('').entries.length === 0, 'empty text -> no entries, no error');
    ok(D.parseWorldbook('{not json').error, 'invalid JSON -> error, no throw');
    const wpObj = D.parseWorldbook('{"entries":[{"name":"X","keys":["x"],"content":"c"}]}');
    ok(wpObj.entries.length === 1, 'accepts {entries:[...]} wrapper too');
    // strategy inference from ST-style fields
    const inf = D.parseWorldbook(JSON.stringify([{ comment: 'C', content: 'c', constant: true }, { comment: 'D', content: 'd', vectorized: true }]));
    ok(inf.entries[0].strategy === 'blue' && inf.entries[1].strategy === 'chain', 'infers blue from constant, chain from bare vectorized', inf.entries.map(e => e.strategy));

    console.log('== worldbook -> SillyTavern mapping ==');
    const st = D.worldbookToST(wp.entries);
    const e0 = st.entries['0'], e2 = st.entries['2'], e3 = st.entries['3'];
    ok(Object.keys(st.entries).length === 4, 'ST object has 4 entries keyed by index');
    ok(e0.key.length === 3 && e0.selective === true && e0.constant === false && e0.vectorized === true, 'green -> keyed + selective + vector-eligible, not constant', { key: e0.key.length, sel: e0.selective, con: e0.constant, vec: e0.vectorized });
    ok(e2.constant === true && e2.key.length === 0 && e2.vectorized === false && e2.selective === false, 'blue -> constant, no keys, not vectorized', { con: e2.constant, vec: e2.vectorized });
    ok(e3.vectorized === true && e3.key.length === 0 && e3.constant === false, 'chain -> vectorized, no keys, not constant');
    ok(e0.uid === 0 && e0.comment === 'Alexia Valois' && typeof e0.content === 'string', 'uid/comment/content populated');
    // schema completeness: fields ST reads must exist
    for (const f of ['uid','key','keysecondary','comment','content','constant','vectorized','selective','order','position','disable','probability','depth']) {
        ok(f in e0, 'ST entry has field: ' + f);
    }

    console.log('== worldbook lint ==');
    const warns = D.lintWorldbook(D.parseWorldbook(JSON.stringify([
        { name: 'NoKeys', keys: [], content: 'x', strategy: 'green' },
        { name: 'Empty', keys: ['k'], content: '', strategy: 'green' },
        { name: 'Dupe', keys: ['a'], content: 'a', strategy: 'green' },
        { name: 'Dupe', keys: ['b'], content: 'b', strategy: 'green' },
    ])).entries);
    ok(warns.some(w => /never fire/.test(w)), 'lints green-without-keys');
    ok(warns.some(w => /empty content/i.test(w)), 'lints empty content');
    ok(warns.some(w => /duplicate/i.test(w)), 'lints duplicate names');

    console.log('== worldbook detection ==');
    ok(D.docLooksLikeWorldbook({ presetId: 'seed_worldbook_maker', text: '' }) === true, 'WB preset marks doc as worldbook');
    ok(D.docLooksLikeWorldbook({ presetId: 'x', text: wbText }) === true, 'valid WB JSON detected by content');
    ok(D.docLooksLikeWorldbook({ presetId: 'x', text: '# Just markdown' }) === false, 'plain markdown is not a worldbook');
    ok(D.docLooksLikeWorldbook({ presetId: 'x', text: '' }) === false, 'empty non-WB doc is not a worldbook');
    // round-trip: ST export re-parsed by our own parser yields same strategies
    const round = D.parseWorldbook(JSON.stringify(D.worldbookToST(wp.entries)));
    ok(round.entries.length === 4 && round.entries[2].strategy === 'blue' && round.entries[3].strategy === 'chain', 'ST export round-trips back through parser', round.entries.map(e => e.strategy));

    // v0.9.0: per-entry field intelligence (position, order, depth, probability)
    console.log('== worldbook per-entry fields ==');
    const fieldsText = JSON.stringify([
        { name: 'History of Wessex', keys: ['Wessex','kingdom'], content: 'x', strategy: 'green', position: 'before_char', order: 300 },
        { name: 'General Aldric', keys: ['Aldric'], content: 'x', strategy: 'green', position: 'after_char', order: 200 },
        { name: 'Active siege', keys: ['siege'], content: 'x', strategy: 'green', position: 'at_depth', depth: 2, order: 150 },
        { name: 'Rumor', keys: ['rumor'], content: 'x', strategy: 'green', probability: 40 },
    ]);
    const fp = D.parseWorldbook(fieldsText);
    ok(fp.entries[0].position === 'before_char' && fp.entries[1].position === 'after_char' && fp.entries[2].position === 'at_depth', 'position strings parsed', fp.entries.map(e => e.position));
    ok(fp.entries[2].depth === 2, 'at_depth keeps custom depth');
    ok(fp.entries[3].probability === 40, 'custom probability parsed');
    ok(fp.entries[3].position === 'after_char' && fp.entries[0].order === 300, 'defaults applied where omitted');
    const fst = D.worldbookToST(fp.entries);
    ok(fst.entries['0'].position === 0, 'before_char -> ST position 0');
    ok(fst.entries['1'].position === 1, 'after_char -> ST position 1');
    ok(fst.entries['2'].position === 4 && fst.entries['2'].depth === 2, 'at_depth -> ST position 4 + depth');
    ok(fst.entries['3'].probability === 40 && fst.entries['3'].useProbability === true, 'probability<100 sets useProbability');
    ok(fst.entries['1'].useProbability === false && fst.entries['1'].probability === 100, 'probability 100 -> useProbability false');
    ok(fst.entries['0'].order === 300, 'order carried to ST');
    // ST numeric position round-trips back to friendly string
    ok(D.normalizePosition(0) === 'before_char' && D.normalizePosition(1) === 'after_char' && D.normalizePosition(4) === 'at_depth', 'ST numeric positions normalize back');
    ok(D.normalizePosition('BEFORE CHAR') === 'before_char' && D.normalizePosition('@depth') === 'at_depth', 'friendly aliases normalize');
    // full round-trip preserves positions
    const fr = D.parseWorldbook(JSON.stringify(fst));
    ok(fr.entries[0].position === 'before_char' && fr.entries[2].position === 'at_depth' && fr.entries[2].depth === 2, 'positions survive full ST round-trip', fr.entries.map(e => e.position));

    // v0.4.0: legacy flat-history docs must migrate into sessions losslessly
    console.log('== session migration ==');
    const legacy = { id: 'd1', name: 'Old Doc', text: 'body', history: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1', swipes: [{ content: 'a1', think: '' }], swipeId: 0 },
        { role: 'note', content: 'n1' },
    ] };
    D.ensureDocShape(legacy);
    ok(Array.isArray(legacy.sessions) && legacy.sessions.length === 1 && legacy.activeSessionId === 1, 'sessions created');
    ok(legacy.history === undefined, 'flat history removed after migration');
    const mig = D.sess(legacy);
    ok(mig && mig.history.length === 3 && mig.history[1].swipes.length === 1 && mig.history[1].content === 'a1', 'all messages + swipes preserved', mig && mig.history.map(h => h.role));

    // v0.11.0: numeric coercion — string-typed fields must survive, not reset
    console.log('== numeric field coercion (the bug) ==');
    ok(D.numOr('250', 100) === 250 && D.numOr(250, 100) === 250, 'numeric string and number both coerce');
    ok(D.numOr('', 100) === 100 && D.numOr(null, 100) === 100 && D.numOr(undefined, 100) === 100, 'empty/null/undefined -> default');
    ok(D.numOr('abc', 100) === 100 && D.numOr(true, 100) === 100 && D.numOr(NaN, 100) === 100, 'non-numeric -> default');
    const coerced = D.parseWorldbook(JSON.stringify([
        { name: 'Spine', keys: ['x'], content: 'c', strategy: 'blue', order: '300' },
        { name: 'Siege', keys: ['s'], content: 'c', strategy: 'green', position: 'at_depth', depth: '2', order: '150' },
        { name: 'Rumor', keys: ['r'], content: 'c', strategy: 'green', probability: '40' },
    ]));
    ok(coerced.entries[0].order === 300, 'string order "300" -> 300 (was silently 100)', coerced.entries[0].order);
    ok(coerced.entries[1].depth === 2 && coerced.entries[1].order === 150, 'string depth/order coerced', { d: coerced.entries[1].depth, o: coerced.entries[1].order });
    ok(coerced.entries[2].probability === 40, 'string probability "40" -> 40', coerced.entries[2].probability);

    // v0.11.0: token budget estimation
    console.log('== worldbook token stats ==');
    ok(D.estTokens('') === 0 && D.estTokens('a') === 1, 'empty -> 0, tiny -> 1');
    ok(D.estTokens('x'.repeat(400)) === 100, '400 chars ~ 100 tokens');
    const tstats = D.worldbookTokenStats(D.parseWorldbook(JSON.stringify([
        { name: 'A', keys: [], content: 'x'.repeat(400), strategy: 'blue' },
        { name: 'B', keys: [], content: 'x'.repeat(400), strategy: 'blue' },
        { name: 'C', keys: ['c'], content: 'x'.repeat(800), strategy: 'green' },
    ])).entries);
    ok(tstats.total === 400 && tstats.alwaysOn === 200 && tstats.blueCount === 2, 'total vs always-on(blue) subtotal split correctly', { total: tstats.total, on: tstats.alwaysOn, blue: tstats.blueCount });
    ok(tstats.perEntry.length === 3 && tstats.perEntry[2].tokens === 200, 'per-entry token counts present');

    // v0.11.0: canonical serializer round-trips losslessly through the parser
    console.log('== worldbook serializer round-trip ==');
    const srcEntries = D.parseWorldbook(JSON.stringify([
        { name: 'Keeps everything', keys: ['a', 'b'], content: 'lore', strategy: 'green', order: 300, position: 'before_char' },
        { name: 'At depth two', keys: ['d'], content: 'more', strategy: 'green', position: 'at_depth', depth: 2, probability: 40 },
        { name: 'Plain default', keys: ['p'], content: 'plain', strategy: 'green' },
        { name: 'Spine', keys: [], content: 'always', strategy: 'blue', order: 320 },
    ])).entries;
    const serialized = D.serializeWorldbook(srcEntries);
    const reparsed = D.parseWorldbook(serialized).entries;
    ok(!D.parseWorldbook(serialized).error && reparsed.length === 4, 'serialized output is valid JSON, 4 entries');
    ok(reparsed[0].order === 300 && reparsed[0].position === 'before_char', 'non-default order/position preserved');
    ok(reparsed[1].position === 'at_depth' && reparsed[1].depth === 2 && reparsed[1].probability === 40, 'at_depth + depth + probability preserved');
    ok(reparsed[2].order === 100 && reparsed[2].position === 'after_char' && reparsed[2].probability === 100, 'defaults intact after round-trip');
    ok(reparsed[3].strategy === 'blue' && reparsed[3].order === 320, 'blue strategy + order preserved');
    // idempotent: serialize(parse(serialize(x))) === serialize(x)
    ok(D.serializeWorldbook(reparsed) === serialized, 'serializer is idempotent');

    // v0.11.0: context window keeps real turns, notes ride along
    console.log('== context window (notes do not evict turns) ==');
    const mkHist = [];
    for (let i = 0; i < 10; i++) { mkHist.push({ role: 'user', content: 'u' + i }); mkHist.push({ role: 'assistant', content: 'a' + i }); mkHist.push({ role: 'note', content: 'applied' + i }); }
    const win = D.pickContextWindow(mkHist, 4);
    const realTurns = win.filter(h => h.role !== 'note').length;
    ok(realTurns === 4, 'exactly `depth` real turns kept regardless of interleaved notes', realTurns);
    ok(win[win.length - 1].role === 'note' && win.some(h => h.role === 'note'), 'notes within the window ride along');
    const winSlice = D.pickContextWindow(mkHist, 2, 3);
    ok(winSlice.every((h, i) => JSON.stringify(h) === JSON.stringify(mkHist.slice(0, 3)[i])), 'uptoIdx slices before that index (swipe path)');

    // v0.11.2: session context total (mirrors buildMessages assembly)
    console.log('== session context breakdown ==');
    const cdoc = { id: 'ctx1', name: 'Ctx Doc', text: ('hello world ').repeat(10).trim(), presetId: '', refs: [] };
    D.ensureDocShape(cdoc);
    const cs = D.sess(cdoc);
    cs.history.push({ role: 'user', content: 'x'.repeat(40) }, { role: 'assistant', content: 'y'.repeat(80) }, { role: 'note', content: 'applied 2 edits' });
    const cb = D.contextTokenBreakdown(cdoc);
    const expDoc = D.estTokens('[DOCUMENT: ' + cdoc.name + ']\n' + cdoc.text + '\n[/DOCUMENT]');
    const expHist = D.estTokens('x'.repeat(40)) + D.estTokens('y'.repeat(80)) + D.estTokens('[STATE] applied 2 edits');
    ok(cb.doc === expDoc, 'document tokens match docBlock estimate', { got: cb.doc, exp: expDoc });
    ok(cb.refsTotal === 0 && cb.refs.length === 0, 'no refs -> 0 ref tokens');
    ok(cb.turns === 2 && cb.notes === 1, 'turn/note counts correct', { turns: cb.turns, notes: cb.notes });
    ok(cb.history === expHist, 'history tokens match (notes prefixed [STATE], counted)', { got: cb.history, exp: expHist });
    ok(cb.system > 0, 'system+protocol contributes tokens', cb.system);
    ok(cb.total === cb.system + cb.doc + cb.refsTotal + cb.history, 'total = system + doc + refs + history', cb.total);
    ok(D.contextTokenBreakdown(null).total === 0, 'null doc -> 0 total');
}, 10);
