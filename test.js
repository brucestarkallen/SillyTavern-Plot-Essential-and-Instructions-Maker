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

// v0.11.11: literal newlines/tabs inside string values (the #1 model JSON slip) are repaired
const litNL = 'here:\n<docedits>\n[\n  {"find": "line one\nline two", "replace": "new one\nnew two\nnew three", "reason": "multi-line raw breaks"}\n]\n</docedits>';
const pNL = D.parseDocEdits(litNL);
ok(pNL.edits.length === 1 && !pNL.error, 'docedits with RAW line breaks inside strings now parses (repaired)', pNL.error || pNL.edits.length);
ok(pNL.edits[0] && pNL.edits[0].find === 'line one\nline two' && pNL.edits[0].replace === 'new one\nnew two\nnew three', 'repaired values keep the breaks as real newlines', pNL.edits[0]);
const litTab = '<docedits>[{"find": "a\tb", "replace": "c", "reason": "raw tab"}]</docedits>';
ok(D.parseDocEdits(litTab).edits.length === 1, 'raw tab inside a string is repaired too');
// a backslash-n that is already correct must survive untouched
const goodNL = '<docedits>[{"find": "a\\nb", "replace": "c", "reason": "ok"}]</docedits>';
const pGood = D.parseDocEdits(goodNL);
ok(pGood.edits.length === 1 && pGood.edits[0].find === 'a\nb', 'already-escaped \\n is not double-escaped', pGood.edits[0]);


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

// v0.11.10: inexact (fuzzy) matches must NOT be applied — they can duplicate/reflow.
const fdoc = 'The rule here is: do not bolt on gloss, and keep the prose plain.';
const fExact = D.applyEditToText(fdoc, { type: 'replace', find: 'do not bolt on gloss', replace: 'do not add gloss', reason: '' });
ok(fExact.ok && (fExact.text.match(/gloss/g) || []).length === 1 && fExact.text.includes('do not add gloss'), 'exact match applies once — no duplicated fragment', fExact.text);
const fInexact = D.applyEditToText(fdoc, { type: 'replace', find: 'do NOT bolt onto the glosss thread', replace: 'X', reason: '' });
ok(fInexact.ok === false, 'inexact/paraphrased find is refused (not applied) so it cannot corrupt', fInexact.reason);
ok(fdoc === 'The rule here is: do not bolt on gloss, and keep the prose plain.', 'source untouched (pure function mutated nothing)');
const fLoc = D.locate(fdoc, 'do NOT bolt onto the glosss thread');
ok(fLoc === null || fLoc.fuzzy === true, 'locate still surfaces the near/fuzzy match for the failure message (just not applied)', fLoc);

// v0.11.12: a whitespace-only difference (edge words match) must APPLY — it is edge-safe,
// so no fragment/reflow — this is the exact case v0.11.10 was wrongly refusing at "100%".
const wsdoc = 'the counter: IF  2+ NPCs then stop and reset.';   // NOTE the double space after IF
const wsHit = D.applyEditToText(wsdoc, { type: 'replace', find: 'IF 2+ NPCs', replace: 'IF two-plus NPCs', reason: '' }); // single space in find
ok(wsHit.ok && wsHit.text.includes('IF two-plus NPCs') && !wsHit.text.includes('IF  2+'), 'whitespace-only mismatch (edges match) now applies — collapses the double space', wsHit.text);
ok((wsHit.text.match(/NPCs/g) || []).length === 1, 'edge-safe apply leaves no duplicated fragment', wsHit.text);
// but an edge-DRIFTING near match (last word differs) is still refused (no wrong-passage corruption)
const driftDoc = 'alpha bravo charlie delta echo';
const drift = D.applyEditToText(driftDoc, { type: 'replace', find: 'alpha bravo charlie foxtrot', replace: 'Z', reason: '' });
ok(drift.ok === false, 'edge-drifting fuzzy (last word differs) is still refused', drift.reason);
// v0.11.13: edges match but a MIDDLE word differs -> refused (edge-safe alone would have
// applied it, overwriting real text with the model's misquote — bad for an authored file)
const midDoc = 'set the rank to Two-fourteen right now';
const midEdit = D.applyEditToText(midDoc, { type: 'replace', find: 'set the rank to Two-thirty-eight right now', replace: 'set the rank to 238 right now', reason: '' });
ok(midEdit.ok === false, 'edges match but a middle word differs -> refused (only whitespace-only diffs auto-apply)', midEdit.reason);
ok(midDoc.includes('Two-fourteen'), 'real text left untouched (not overwritten by an ~85% guess)', midDoc);

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
    function simSwipe(pending, sid, idx, newEdits, seq) {
        pending = pending.filter(e => e.status !== 'pending' || !(e.fromSess === sid && e.fromMsg === idx));
        if (newEdits.length) {
            seq.n++;
            for (const e of newEdits) { e.batch = seq.n; e.fromSess = sid; e.fromMsg = idx; }
            pending = pending.concat(newEdits);
        }
        return pending;
    }
    let sp = [{ id: 'x', status: 'pending', fromSess: 1, fromMsg: 5, batch: 1 }];
    sp = simSwipe(sp, 1, 5, [{ id: 'y', status: 'pending' }], seq);
    ok(sp.length === 1 && sp[0].id === 'y', 'swiping the same reply replaces its cards');
    // v0.12.0: the filter is (session, message) scoped — a swipe in ANOTHER
    // session at the same index must not touch this session's cards.
    sp = simSwipe(sp, 2, 5, [{ id: 'z', status: 'pending' }], seq);
    ok(sp.length === 2 && sp.some(e => e.id === 'y') && sp.some(e => e.id === 'z'), 'same index in a different session does not nuke the other session\u2019s cards');

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
    ok(cb.total === cb.system + cb.doc + cb.refsTotal + cb.history + cb.proposals, 'total = system + doc + refs + history + proposals', cb.total);
    ok(cb.proposals === 0, 'no pending proposals in this test', cb.proposals);
    ok(D.contextTokenBreakdown(null).total === 0, 'null doc -> 0 total');


    // supersede parsing + pending-proposals awareness (agent parity with copilot)
    console.log('== supersede parsing ==');
    ok(JSON.stringify(D.parseSupersede('<supersede>1</supersede>')) === '[1]', 'single number');
    ok(JSON.stringify(D.parseSupersede('text <supersede>1, 2</supersede> more')) === '[1,2]', 'comma list');
    ok(JSON.stringify(D.parseSupersede('<supersede>Edit 3</supersede>')) === '[3]', '"Edit N" form');
    ok(JSON.stringify(D.parseSupersede('<supersede>[1, 2]</supersede>')) === '[1,2]', 'JSON-ish form');
    ok(JSON.stringify(D.parseSupersede('a<supersede>\n1\n2\n</supersede>b')) === '[1,2]', 'newline form');
    ok(JSON.stringify(D.parseSupersede('<supersede>1,1,2</supersede>')) === '[1,2]', 'dedupes');
    ok(D.parseSupersede('no tag here').length === 0, 'absent -> []');
    ok(D.parseSupersede('<supersede></supersede>').length === 0, 'empty -> []');
    ok(D.parseSupersede('<supersede>0</supersede>').length === 0, 'zero ignored (1-based)');

    console.log('== pending-proposals block ==');
    ok(D.formatPendingProposals([]) === '', 'no edits -> empty');
    ok(D.formatPendingProposals([{ status: 'applied', type: 'replace', reason: 'x' }]) === '', 'no pending -> empty');
    const ppb = D.formatPendingProposals([
        { status: 'applied', type: 'replace', reason: 'done' },
        { status: 'pending', type: 'replace', reason: 'fix the magic' },
        { status: 'pending', type: 'append', docName: 'Lore.json', reason: 'add faction' },
    ]);
    ok(/\[PENDING PROPOSALS/.test(ppb), 'has header');
    ok(/Edit 2 \(replace\): fix the magic/.test(ppb), 'numbering matches array index (skips applied Edit 1)', ppb);
    ok(/Edit 3 \(append \u2192 Lore\.json\): add faction/.test(ppb), 'shows kind + target doc', ppb);
    ok(/supersede/.test(ppb), 'teaches the supersede tag');
    ok(!/supersede/i.test(D.stripBlocks('hello <supersede>1</supersede> world')), 'stripBlocks removes the supersede tag from display');
    ok(/proposed edits below/.test(D.stripBlocks('foo\n<docedits>\n[]\n</docedits>')), 'stripBlocks still collapses docedits');
}, 10);

// v0.11.14: deterministic document linter (whitespace + JSON) — no LLM guessing
console.log('== docLint (deterministic) ==');
ok(D.docLint('line one\nline two with words\n    indented ok').inlineCount === 0, 'clean text -> 0 inline double-spaces');
const lintDblRes = D.docLint('has  two spaces\nand   three there');
ok(lintDblRes.inlineCount === 2, 'finds 2 inline double-space runs', lintDblRes.inlineCount);
ok(lintDblRes.inlineDoubleSpaces[0].sample.indexOf('\u00B7\u00B7') !== -1, 'sample shows spaces as middle-dots (visible)', lintDblRes.inlineDoubleSpaces[0]);
ok(D.docLint('        leading indent only').inlineCount === 0, 'leading indentation NOT flagged as inline double-space');
ok(D.docLint('trailing here  \nok').trailingWs === 1, 'trailing whitespace counted');
ok(D.docLint('{"a":1}').jsonValid === true, 'valid JSON detected');
const lintBadJsonRes = D.docLint('{"a": "line one\nline two"}');
ok(lintBadJsonRes.jsonLike && lintBadJsonRes.jsonValid === false && lintBadJsonRes.jsonFixable, 'invalid JSON (raw newline) detected + fixable', lintBadJsonRes);
ok(D.docLint('just prose, not json').jsonLike === false, 'non-JSON is not JSON-checked');
console.log('== collapseInlineSpaces + repairDocJson ==');
ok(D.collapseInlineSpaces('a  b   c') === 'a b c', 'collapses inline runs to single space');
ok(D.collapseInlineSpaces('        keep indent  then one') === '        keep indent then one', 'preserves leading indent, collapses inline');
ok(D.collapseInlineSpaces('line one\nline  two') === 'line one\nline two', 'per-line, preserves newlines');
const lintRjRes = D.repairDocJson('{"a": "x\ny"}');
ok(lintRjRes.changed && JSON.parse(lintRjRes.text).a === 'x\ny', 'repairDocJson escapes raw newline -> valid, content preserved', lintRjRes);
ok(D.repairDocJson('{"a":1}').changed === false, 'valid JSON unchanged by repair');
// v0.11.16: global literal replace ("all": true) — every exact occurrence, foolproof
console.log('== global literal replace (all:true) ==');
const gGDoc = 'X marks the X. Find the other X here.';
const gAll = D.applyEditToText(gGDoc, { type: 'replace', find: 'X', replace: 'Y', all: true, reason: '' });
ok(gAll.ok && gAll.text === 'Y marks the Y. Find the other Y here.', 'all:true replaces EVERY exact occurrence', gAll.text);
ok(/replaced 3 occurrence/.test(gAll.note || ''), 'note reports the occurrence count', gAll.note);
const gMiss = D.applyEditToText(gGDoc, { type: 'replace', find: 'Z', replace: 'W', all: true, reason: '' });
ok(gMiss.ok === false, 'all:true is literal exact — a find not present fails cleanly (no corruption)', gMiss.reason);
ok(gGDoc.indexOf('X') !== -1, 'document untouched on a failed global replace');
const gOne = D.applyEditToText(gGDoc, { type: 'replace', find: 'X', replace: 'FIRST', reason: '' });
ok(gOne.ok && gOne.text.indexOf('FIRST') === 0 && (gOne.text.match(/X/g) || []).length === 2, 'WITHOUT all: only the first occurrence changes (unchanged behavior)', gOne.text);
const gp = D.parseDocEdits('<docedits>[{"find":"a","replace":"b","all":true,"reason":"r"}]</docedits>');
ok(gp.edits.length === 1 && gp.edits[0].all === true, 'parser preserves the all flag', gp.edits[0]);
const gp2 = D.parseDocEdits('<docedits>[{"find":"a","replace":"b","reason":"r"}]</docedits>');
ok(gp2.edits[0].all === false, 'no flag -> all:false (single occurrence)', gp2.edits[0]);
// v0.11.17: pending-proposals block labels an all-edit as a global replace
console.log('== pending block: global-replace label ==');
const ppAllEdit = D.formatPendingProposals([{ status: 'pending', type: 'replace', all: true, reason: 'rename everywhere' }]);
ok(/Edit 1 \(global replace \(every occurrence\)\): rename everywhere/.test(ppAllEdit), 'all-edit labeled as global replace in the block the agent reads', ppAllEdit);
ok(/Edit 1 \(replace\):/.test(D.formatPendingProposals([{ status: 'pending', type: 'replace', reason: 'x' }])), 'a normal replace is still labeled "replace"');

// ==================================================================
// v0.12.0 — deep audit fixes
// ==================================================================

// splitThinking must never reach inside the docedits block. This tool edits
// AI-instruction documents, so think-tags legitimately occur in prose AND
// inside edit strings; the old single-pass extraction gutted the block.
console.log('== splitThinking: docedits block protection ==');
const bp1 = D.splitThinking('I added the <thinking> tag rule as asked.\n<docedits>[{"append":true,"replace":"x","reason":"r"}]</docedits>');
ok(D.parseDocEdits(bp1.rest).edits.length === 1, 'unclosed prose mention BEFORE the block no longer swallows the block', bp1.rest.slice(0, 80));
const bp2 = D.splitThinking('ok\n<docedits>[{"find":"use <think> tags for reasoning","replace":"use <thinking> tags","reason":"r"}]</docedits>');
const bp2p = D.parseDocEdits(bp2.rest);
ok(bp2p.edits.length === 1 && bp2p.edits[0].find === 'use <think> tags for reasoning', 'unclosed think-tag INSIDE a docedits string no longer guts the JSON', bp2p);
const bp3 = D.splitThinking('<think>plan</think>Done.\n<docedits>[{"find":"wrap in <think>","replace":"wrap in <think> and close with </think>","reason":"r"}]</docedits>');
const bp3p = D.parseDocEdits(bp3.rest);
ok(bp3.think === 'plan' && bp3p.edits.length === 1 && bp3p.edits[0].replace.indexOf('</think>') !== -1, 'a closed pair can no longer be matched ACROSS the block (open in find, close in replace)', bp3p.edits[0]);
const bp4 = D.splitThinking('<think>going\n<docedits>[{"append":true,"replace":"y","reason":"r"}]</docedits>');
ok(bp4.think.indexOf('going') !== -1 && D.parseDocEdits(bp4.rest).edits.length === 1, 'genuinely unclosed reasoning before the block: swallowed up to the block, block survives', bp4);
ok(D.splitThinking('<think>partial reasoning never closed').rest === '' && D.splitThinking('<think>partial reasoning never closed').think.indexOf('partial') !== -1, 'no block present: unclosed leading reasoning still fully swallowed (unchanged)');
const bp5 = D.splitThinking('<think>R</think>\nprose\n<docedits>[{"append":true,"replace":"z","reason":"r"}]</docedits>');
ok(bp5.think === 'R' && D.parseDocEdits(bp5.rest).edits.length === 1, 'normal leading reasoning + block: both preserved');
const bp6 = D.splitThinking('<think>a <docedits>[{"append":true,"replace":"z","reason":"r"}]</docedits> b</think>');
ok(D.parseDocEdits(bp6.rest).edits.length === 1, 'a pair straddling the WHOLE block from outside prose cannot gut the JSON', bp6.rest);
ok(!/<\/think>/i.test(bp6.rest), 'the stranded closer left in the tail is cleaned out of prose (orphan-closer strip)', bp6.rest);
const bp7 = D.splitThinkingSegment('<think>x</think>y');
ok(bp7.rest === 'y' && bp7.think === 'x', 'splitThinkingSegment (no-block path) exported and unchanged');

// String-aware trailing-comma stripping: the old blind regex rewrote ", ]"
// INSIDE string values — silent content mutation in every JSON repair pass.
console.log('== stripTrailingCommasOutsideStrings ==');
ok(JSON.parse(D.stripTrailingCommasOutsideStrings('[1,2,]'))[1] === 2, 'real trailing comma stripped');
const stc1 = JSON.parse(D.stripTrailingCommasOutsideStrings('{"a": "list: [1, 2, ]", "b": [3,],}'));
ok(stc1.a === 'list: [1, 2, ]' && stc1.b.length === 1 && stc1.b[0] === 3, 'comma-bracket inside a STRING preserved; structural trailing commas stripped', stc1);
const stc2 = JSON.parse(D.stripTrailingCommasOutsideStrings('{"a":"he said \\"hi, ]\\", ok",}'));
ok(stc2.a === 'he said "hi, ]", ok', 'escaped quotes inside strings do not desync the scanner', stc2.a);
ok(D.stripTrailingCommasOutsideStrings('{"a":1}') === '{"a":1}', 'already-valid JSON passes through byte-identical');
const stcE2E = D.parseDocEdits('<docedits>[{"append":true,"replace":"Options: [a, b, ]","reason":"r"},]</docedits>');
ok(stcE2E.edits.length === 1 && stcE2E.edits[0].replace === 'Options: [a, b, ]', 'END TO END: repair fixes the trailing comma without mutating the value content', stcE2E.edits[0]);
const stcWB = D.parseWorldbook('[{"name":"N","keys":["k"],"content":"choices: [x, y, ]","strategy":"green"},]');
ok(stcWB.entries.length === 1 && stcWB.entries[0].content === 'choices: [x, y, ]', 'worldbook tolerant parse also preserves string content', stcWB.entries[0] && stcWB.entries[0].content);

console.log('== escapeRawControlsInStrings: all C0 controls ==');
const ctl = D.escapeRawControlsInStrings('{"a":"x\fy\bz\u0001"}');
let ctlParsed = null;
try { ctlParsed = JSON.parse(ctl); } catch (e) { /* fail below */ }
ok(ctlParsed && ctlParsed.a === 'x\fy\bz\u0001', 'raw \\f, \\b and other C0 controls inside strings now repair (not just \\n\\r\\t)', ctl);

console.log('== bounded levenshtein (perf guard, identical results) ==');
ok(D.levenshtein('kitten', 'sitting') === 3, 'unbounded classic = 3');
ok(D.levenshtein('kitten', 'sitting', 3) === 3, 'bound == true distance: identical result');
ok(D.levenshtein('kitten', 'sitting', 2) > 2, 'over-bound candidate aborts with a value strictly above the bound');
ok(D.levenshtein(['a', 'b', 'c'], ['a', 'x', 'c'], 1) === 1, 'word arrays with bound');
ok(D.levenshtein('abcdefgh', 'z', 2) > 2, 'length-gap shortcut aborts immediately');
// brute-force fallback path (no alignment votes) must stay fast on Android:
let bf = '';
for (let i = 0; i < 700; i++) bf += 'segment ' + i + ' holds ' + (i % 9) + ' units in bay ' + (i % 4) + '\n';
const bft0 = Date.now();
const bfr = D.locate(bf, 'wholly absent needle words qqq zzz vvv kkk');
const bfms = Date.now() - bft0;
ok(bfr === null, 'absent needle on a vote-less doc -> null (brute-force path)');
ok(bfms < 400, 'brute-force fallback fast with the early-exit bound (' + bfms + 'ms)');

console.log('== locate: normalized-path ambiguity count ==');
const lnc = D.locate('\u201Cx y\u201D and \u201Cx y\u201D again', '"x y"');
ok(lnc && !lnc.fuzzy && lnc.count === 2, 'quote-normalized match counts occurrences like the exact path', lnc);

console.log('== blockTokensFor: allocation-free == built-string estimate ==');
for (const dd of [{ name: 'A', text: '' }, { name: 'Weird \u2014 name', text: 'hello world' }, { name: undefined, text: 'x'.repeat(999) }]) {
    ok(D.blockTokensFor(dd, false) === D.estTokens(D.docBlock(dd)), 'doc block tokens match built string (' + (dd.name || 'untitled') + ')', { fast: D.blockTokensFor(dd, false), built: D.estTokens(D.docBlock(dd)) });
    ok(D.blockTokensFor(dd, true) === D.estTokens(D.refBlock(dd)), 'ref block tokens match built string (' + (dd.name || 'untitled') + ')');
}

console.log('== buildMessages: the document is ALWAYS injected ==');
const bmDoc = D.ensureDocShape({ id: 'bm1', name: 'BM Doc', text: 'THE BODY TEXT', presetId: 'seed_pe_maker' });
D.sess(bmDoc).history.push({ role: 'assistant', content: 'orphan reply with no user turn' });
const bmA = D.buildMessages(bmDoc);
const bmLast = bmA[bmA.length - 1];
ok(bmLast.role === 'user' && bmLast.content.indexOf('[DOCUMENT: BM Doc]') !== -1 && bmLast.content.indexOf('THE BODY TEXT') !== -1, 'no user turn in window -> synthetic trailing user message carries the document', bmLast.content.slice(0, 60));
D.sess(bmDoc).history.push({ role: 'user', content: 'change it please' });
const bmB = D.buildMessages(bmDoc);
const bmBLast = bmB[bmB.length - 1];
ok(bmBLast.role === 'user' && bmBLast.content.indexOf('[DOCUMENT: BM Doc]') !== -1 && /change it please\s*$/.test(bmBLast.content), 'normal path: document rides the LAST user message (recency)', bmBLast.content.slice(-40));
ok(bmB.filter(m => m.content.indexOf('[DOCUMENT: BM Doc]') !== -1).length === 1, 'document injected exactly once');
ok(bmB[0].role === 'system' && bmB[0].content.indexOf('DOCEDITS PROTOCOL') !== -1, 'system carries preset + protocol');

console.log('== adjustStampsForSplice (proposal provenance) ==');
const stamps = () => ([
    { id: 'a', fromSess: 1, fromMsg: 2, status: 'pending' },
    { id: 'b', fromSess: 1, fromMsg: 5, status: 'applied' },
    { id: 'c', fromSess: 2, fromMsg: 5, status: 'pending' },
    { id: 'd', status: 'pending' },
]);
let asr = D.adjustStampsForSplice(stamps(), 1, 4, Infinity);
ok(asr.length === 3 && !asr.some(e => e.id === 'b') && asr.some(e => e.id === 'c') && asr.some(e => e.id === 'd'), 'tail splice drops only this session\u2019s edits at/after the cut (other session + unstamped kept)', asr.map(e => e.id));
asr = D.adjustStampsForSplice(stamps(), 1, 1, 1);
ok(asr.length === 4 && asr.find(e => e.id === 'a').fromMsg === 1 && asr.find(e => e.id === 'b').fromMsg === 4 && asr.find(e => e.id === 'c').fromMsg === 5, 'single delete before the sources shifts this session\u2019s stamps down by 1 only', asr.map(e => [e.id, e.fromMsg]));
asr = D.adjustStampsForSplice(stamps(), 1, 2, 1);
ok(!asr.some(e => e.id === 'a') && asr.find(e => e.id === 'b').fromMsg === 4, 'deleting the source message drops exactly its edits', asr.map(e => e.id));
asr = D.adjustStampsForSplice(stamps(), 1, 0, 3);
ok(!asr.some(e => e.id === 'a') && asr.find(e => e.id === 'b').fromMsg === 2, 'cap-splice from the front drops fallen-off sources and shifts the rest', asr.map(e => [e.id, e.fromMsg]));
asr = D.adjustStampsForSplice(stamps(), 3, 0, Infinity);
ok(asr.length === 4, 'a splice in an unrelated session touches nothing');

console.log('== editIdentityKey + swipe re-navigation dedupe (double-apply fix) ==');
ok(D.editIdentityKey({ type: 'append', replace: 'x' }) === D.editIdentityKey({ type: 'append', replace: 'x', status: 'applied', batch: 3, fromMsg: 1 }), 'identity ignores bookkeeping fields');
ok(D.editIdentityKey({ type: 'replace', find: 'a', replace: 'x' }) !== D.editIdentityKey({ type: 'replace', find: 'a', replace: 'y' }), 'different payload = different proposal');
ok(D.editIdentityKey({ type: 'replace', find: 'a', replace: 'x' }) !== D.editIdentityKey({ type: 'replace', find: 'a', replace: 'x', all: true }), 'all:true is part of identity');
function simSwipeNav(pending, sid, idx, parsedEdits, seq2) {
    // mirrors the existing-swipe branch of swipeAssistant (v0.12.0)
    pending = pending.filter(e => e.status !== 'pending' || !(e.fromSess === sid && e.fromMsg === idx));
    const consumed = new Set(pending.filter(e => e.fromSess === sid && e.fromMsg === idx && e.status !== 'pending').map(D.editIdentityKey));
    const fresh = parsedEdits.filter(e => !consumed.has(D.editIdentityKey(e)));
    if (fresh.length) { seq2.n++; for (const e of fresh) { e.batch = seq2.n; e.fromSess = sid; e.fromMsg = idx; } pending = pending.concat(fresh); }
    return pending;
}
const seqN = { n: 0 };
let nav = [{ type: 'append', replace: 'TAIL', status: 'applied (…)', fromSess: 1, fromMsg: 7, batch: 1 }];
nav = simSwipeNav(nav, 1, 7, [{ type: 'append', replace: 'TAIL', status: 'pending' }], seqN);
ok(nav.length === 1 && !nav.some(e => e.status === 'pending'), 'an already-APPLIED append is not resurrected as pending on swipe re-navigation (double-apply fix)', nav);
nav = simSwipeNav(nav, 1, 7, [{ type: 'append', replace: 'TAIL', status: 'pending' }, { type: 'append', replace: 'OTHER', status: 'pending' }], seqN);
ok(nav.filter(e => e.status === 'pending').length === 1 && nav.find(e => e.status === 'pending').replace === 'OTHER', 'only the genuinely new proposal re-stages beside the consumed one', nav.map(e => [e.replace, e.status]));

// ==================================================================
// v0.12.1 — mechanical auto-supersede at staging time
// ==================================================================
// The reported failure: propose -> re-ask WITHOUT apply/skip -> propose again
// -> Apply all applied the first and the second couldn't find its text (or
// nested garbage when the replacement contained the find). Conflicts that are
// PROVABLE without model cooperation are now resolved when the new proposal
// stages: the older pending card is visibly superseded, newest wins.
console.log('== findAutoSuperseded: conflict rules ==');
const dk = (e) => e.docName || 'main';
const P = (o) => Object.assign({ status: 'pending', batch: 1 }, o);
let fas = D.findAutoSuperseded(
    [P({ type: 'replace', find: 'the word', replace: 'A' })],
    [{ type: 'replace', find: 'the word', replace: 'B', status: 'pending' }], dk);
ok(fas.length === 1 && fas[0].replace === 'A', 'same find, different replace, same doc -> older superseded (first-occurrence collision)');
fas = D.findAutoSuperseded(
    [P({ type: 'append', replace: 'THE TAIL' })],
    [{ type: 'append', replace: 'THE TAIL', status: 'pending' }], dk);
ok(fas.length === 1, 'exact duplicate payload (re-ask) -> older superseded, even for appends');
fas = D.findAutoSuperseded(
    [P({ type: 'append', replace: 'row one' })],
    [{ type: 'append', replace: 'row two', status: 'pending' }], dk);
ok(fas.length === 0, 'different appends never conflict (both can apply)');
fas = D.findAutoSuperseded(
    [P({ type: 'insert', find: 'anchor X', replace: 'new para' })],
    [{ type: 'replace', find: 'anchor X', replace: 'Y', status: 'pending' }], dk);
ok(fas.length === 0, 'insert vs replace on the same anchor is NOT auto-resolved (insert does not consume its anchor; both may be wanted)');
fas = D.findAutoSuperseded(
    [P({ type: 'replace', find: 'a', replace: 'b' }), P({ type: 'append', replace: 'tail' }), P({ type: 'replace', find: 'c', replace: 'd', docName: 'Other.md' })],
    [{ type: 'replace_all', replace: 'WHOLE NEW DOC', status: 'pending' }], dk);
ok(fas.length === 2 && !fas.some(e => e.docName === 'Other.md'), 'incoming whole-doc rewrite supersedes all older pending on THAT doc only', fas.length);
fas = D.findAutoSuperseded(
    [P({ type: 'replace_all', replace: 'OLD REWRITE' })],
    [{ type: 'replace', find: 'x', replace: 'y', status: 'pending' }], dk);
ok(fas.length === 0, 'an OLDER pending rewrite is not silently killed by a newer targeted edit');
fas = D.findAutoSuperseded(
    [P({ type: 'replace', find: 'k', replace: 'v', status: 'applied' })],
    [{ type: 'replace', find: 'k', replace: 'w', status: 'pending' }], dk);
ok(fas.length === 0, 'non-pending (applied/failed/skipped) older edits are never touched');
fas = D.findAutoSuperseded(
    [P({ type: 'replace', find: 'same', replace: 'a', docName: 'A.md' })],
    [{ type: 'replace', find: 'same', replace: 'b', docName: 'B.md', status: 'pending' }], dk);
ok(fas.length === 0, 'same find on DIFFERENT documents does not conflict');
fas = D.findAutoSuperseded(
    [P({ type: 'replace', find: 'X', replace: 'Y', all: true })],
    [{ type: 'replace', find: 'X', replace: 'Z', status: 'pending' }], dk);
ok(fas.length === 1, 'global replace vs targeted replace with the same find still collide');

console.log('== end-to-end: the reported double-apply scenario ==');
// Doc: "Rule: the hero never lies." | Turn 1 proposes lies->deceives. User
// re-asks. Turn 2 proposes lies->misleads. Apply all.
(function () {
    const docText = 'Rule: the hero never lies. End.';
    let staged = [P({ type: 'replace', find: 'never lies', replace: 'never deceives', batch: 1 })];
    const incoming = [{ type: 'replace', find: 'never lies', replace: 'never misleads', status: 'pending' }];
    // staging-time resolution (mirrors autoSupersedeConflicts on one doc):
    for (const l of D.findAutoSuperseded(staged, incoming, dk)) l.status = 'superseded';
    staged = staged.concat(incoming.map(e => Object.assign(e, { batch: 2 })));
    // Apply all pending (same filter the button uses):
    let text = docText, applied = 0, failed = 0;
    for (const e of staged) {
        if (e.status !== 'pending') continue;
        const r = D.applyEditToText(text, e);
        if (r.ok) { text = r.text; applied++; } else { failed++; }
    }
    ok(applied === 1 && failed === 0, 'Apply all applies exactly ONE edit, zero failures (was: 1 applied + 1 "not found")', { applied, failed });
    ok(text.indexOf('never misleads') !== -1 && text.indexOf('deceives') === -1, 'the NEWEST proposal wins', text);
    ok(staged[0].status === 'superseded', 'the older card is visibly superseded, not silently failed');
})();
// The nastier variant: the replacement CONTAINS the find, so the stale
// duplicate would have located INSIDE the first application and nested garbage
// instead of failing loudly.
(function () {
    let staged = [P({ type: 'replace', find: 'the king', replace: 'the king of ash', batch: 1 })];
    const incoming = [{ type: 'replace', find: 'the king', replace: 'the king of embers', status: 'pending' }];
    for (const l of D.findAutoSuperseded(staged, incoming, dk)) l.status = 'superseded';
    staged = staged.concat(incoming.map(e => Object.assign(e, { batch: 2 })));
    let text = 'Bow to the king now.';
    for (const e of staged) {
        if (e.status !== 'pending') continue;
        const r = D.applyEditToText(text, e);
        if (r.ok) text = r.text;
    }
    ok(text === 'Bow to the king of embers now.', 'nesting corruption impossible: no "king of ash of embers"', text);
})();
