/*
 * Lore Agent — a SillyTavern extension for AI-edited documents.
 *
 * A floating chat panel where you talk to an agent about a markdown/text
 * document (world lore "Plot Essentials", AI instruction sets, anything),
 * and the agent edits the document directly via surgical find/replace,
 * insert-after and append operations — shown as red/green diff cards with
 * Apply / Skip / Undo. Documents are global (chat-independent) and live in
 * extension settings, so they exist before any story does.
 *
 * Sibling of Continuity Copilot (same author, same engineering patterns).
 * License: MIT.
 */

(() => {
    'use strict';

    const MODULE = 'loreAgent';
    const LOG = '[LoreAgent]';
    const VERSION = '0.1.0';

    // ------------------------------------------------------------------
    // Seeded presets (placeholders — paste your real instructions via the
    // preset Edit button; they can be 20k+ chars, no length caps anywhere)
    // ------------------------------------------------------------------

    const PRESET_PE_ID = 'seed_pe_maker';
    const PRESET_AI_ID = 'seed_ai_instructions';

    const DEFAULT_PRESET_PROMPTS = {
        [PRESET_PE_ID]: 'You are a world-lore architect who edits the document with surgical docedits. (Placeholder — open this preset\'s Edit button and paste the full Plot Essential Maker instructions.)',
        [PRESET_AI_ID]: 'You are an expert author of AI instruction sets who edits the document with surgical docedits. (Placeholder — open this preset\'s Edit button and paste the full instructions.)',
    };

    function defaultPresets() {
        return [
            { id: PRESET_PE_ID, name: 'Plot Essential Maker', prompt: DEFAULT_PRESET_PROMPTS[PRESET_PE_ID] },
            { id: PRESET_AI_ID, name: 'AI Instructions Maker', prompt: DEFAULT_PRESET_PROMPTS[PRESET_AI_ID] },
        ];
    }

    // ------------------------------------------------------------------
    // The docedits protocol — appended to EVERY preset programmatically,
    // never stored inside presets, so protocol upgrades ship with the
    // extension and users never have to touch their prompts.
    // ------------------------------------------------------------------

    const DOCEDITS_PROTOCOL = [
        '=== DOCEDITS PROTOCOL (attached automatically by the Lore Agent extension — follow it exactly, never restate it) ===',
        'You are working on the text file shown in [DOCUMENT]. You change it ONLY by ending a reply with exactly one block in this exact format:',
        '',
        '<docedits>',
        '[',
        '  {"find": "verbatim excerpt copied character-for-character from the document", "replace": "new text", "reason": "short why"},',
        '  {"insert_after": "verbatim anchor line copied from the document", "replace": "new paragraph placed on a new line under the anchor line", "reason": "short why"},',
        '  {"append": true, "replace": "text added at the end of the document", "reason": "short why"},',
        '  {"replace_all": true, "replace": "entire new document text", "reason": "only when the user explicitly asked for a full rewrite"}',
        ']',
        '</docedits>',
        '',
        'Rules:',
        '1. "find" and "insert_after" must be copied CHARACTER-FOR-CHARACTER from the current [DOCUMENT]: same wording, punctuation, capitalization, spacing and line breaks (write line breaks as \\n). Never paraphrase, trim, or fix typos inside them.',
        '2. Keep "find" as short as possible while staying unique in the document (one line up to a few lines). If the excerpt appears more than once, extend it until it is unique.',
        '3. Prefer several small surgical edits over one big rewrite. Use "append" for new sections at the end of the document. Use "insert_after" to add content below an existing line: its "replace" text is placed starting on a new line directly under the anchor line — put a leading \\n inside "replace" if you want a blank line between them. Use "replace_all" ONLY when the user explicitly requests a full rewrite of the whole document.',
        '4. The block must be valid JSON: double quotes, \\n for newlines inside strings, no comments, no trailing commas, no markdown fences.',
        '5. At most ONE docedits block per reply, placed at the very END of the reply, after a brief prose explanation of what you changed and why. If nothing needs changing, output no block at all.',
        '6. In prose, refer to the mechanism as the "docedits block" in plain words. The literal angle-bracket tag must appear ONLY around the actual JSON block, never inside explanations.',
        '7. If the document is empty, draft it with "append" edits (one per section works well).',
    ].join('\n');

    // ------------------------------------------------------------------
    // Defaults + module state
    // ------------------------------------------------------------------

    const defaults = {
        profileId: '',
        maxTokens: 4096,
        historyDepth: 16,
        streaming: true,
        showThinking: true,
        activeDocId: '',
        docs: [],      // [{id, name, text, updated, presetId, history, undo}]
        presets: [],   // [{id, name, prompt}]
    };

    let settings = null;
    let pendingEdits = [];   // [{type, find, replace, reason, status}]
    let editsCollapsed = false;
    let running = false;
    let inited = false;
    let initTries = 0;
    let stopRequested = false;
    let abortCtl = null;

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------

    function ctx() {
        return SillyTavern.getContext();
    }

    function esc(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function oneLine(s) {
        return String(s || '').replace(/\s+/g, ' ').trim();
    }

    function uid() {
        return 'la_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function toast(msg, type) {
        try {
            if (typeof window !== 'undefined' && window.toastr) {
                (window.toastr[type || 'info'] || window.toastr.info)(msg, 'Lore Agent');
                return;
            }
        } catch (e) { /* ignore */ }
        console.log(LOG, msg);
    }

    function el(id) { return document.getElementById(id); }

    async function copyText(t) {
        try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* insecure origin (http/LAN) etc. */ }
        try {
            const ta = document.createElement('textarea');
            ta.value = t;
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (e) { return false; }
    }

    function safeFileName(name) {
        const n = String(name || 'document').replace(/[\\/:*?"<>|]+/g, '_').trim();
        return n || 'document';
    }

    function downloadText(name, text) {
        try {
            const blob = new Blob([String(text ?? '')], { type: 'text/markdown;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = safeFileName(name) + '.md';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (e) { /* ignore */ } }, 4000);
            return true;
        } catch (e) {
            console.error(LOG, 'download failed', e);
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Settings + documents + presets (all global, chat-independent —
    // this extension NEVER touches chat, chatMetadata, or chat events)
    // ------------------------------------------------------------------

    function loadSettings() {
        const c = ctx();
        c.extensionSettings[MODULE] = Object.assign({}, defaults, c.extensionSettings[MODULE] || {});
        settings = c.extensionSettings[MODULE];
        if (!Array.isArray(settings.docs)) settings.docs = [];
        if (!Array.isArray(settings.presets)) settings.presets = [];
        // Seed the two built-in presets if missing (they can be edited, not deleted).
        for (const p of defaultPresets()) {
            if (!settings.presets.some(x => x && x.id === p.id)) settings.presets.push(p);
        }
        settings.presets = settings.presets.filter(p => p && typeof p === 'object' && p.id);
        for (const p of settings.presets) {
            p.name = String(p.name || 'Unnamed preset');
            p.prompt = String(p.prompt ?? '');
        }
        settings.docs = settings.docs.filter(d => d && typeof d === 'object' && d.id);
        for (const d of settings.docs) ensureDocShape(d);
        if (!settings.docs.some(d => d.id === settings.activeDocId)) {
            settings.activeDocId = settings.docs[0]?.id || '';
        }
    }

    function persist() {
        try { ctx().saveSettingsDebounced?.(); } catch (e) { /* ignore */ }
    }

    function ensureDocShape(d) {
        d.name = String(d.name || 'Untitled');
        d.text = String(d.text ?? '');
        if (!Number.isFinite(d.updated)) d.updated = Date.now();
        if (!settingsHasPreset(d.presetId)) d.presetId = PRESET_PE_ID;
        if (!Array.isArray(d.history)) d.history = [];
        if (!Array.isArray(d.undo)) d.undo = [];
        return d;
    }

    function settingsHasPreset(id) {
        return !!(settings && Array.isArray(settings.presets) && settings.presets.some(p => p.id === id));
    }

    function makeDoc(name, text) {
        return ensureDocShape({
            id: uid(),
            name: String(name || 'Untitled'),
            text: String(text ?? ''),
            updated: Date.now(),
            presetId: PRESET_PE_ID,
            history: [],
            undo: [],
        });
    }

    function activeDoc() {
        if (!settings) return null;
        return settings.docs.find(d => d.id === settings.activeDocId) || null;
    }

    function setActiveDoc(id) {
        settings.activeDocId = id || '';
        pendingEdits = [];
        editsCollapsed = false;
        persist();
    }

    function presetById(id) {
        return settings.presets.find(p => p.id === id) || null;
    }

    function presetForDoc(doc) {
        if (!doc) return settings.presets[0] || null;
        let p = presetById(doc.presetId);
        if (!p) {
            p = settings.presets[0] || null;
            if (p) { doc.presetId = p.id; persist(); }
        }
        return p;
    }

    function pushHistory(doc, role, content, think) {
        if (!doc) return;
        const entry = { role, content: String(content ?? '') };
        if (think) entry.think = String(think).slice(0, 20000);
        if (role === 'assistant') {
            entry.swipes = [{ content: entry.content, think: entry.think || '' }];
            entry.swipeId = 0;
        }
        doc.history.push(entry);
        if (doc.history.length > 80) doc.history.splice(0, doc.history.length - 80);
        persist();
        return entry;
    }

    function ensureSwipes(entry) {
        if (!Array.isArray(entry.swipes) || !entry.swipes.length) {
            entry.swipes = [{ content: entry.content, think: entry.think || '' }];
            entry.swipeId = 0;
        }
        if (!Number.isInteger(entry.swipeId) || entry.swipeId < 0 || entry.swipeId >= entry.swipes.length) {
            entry.swipeId = entry.swipes.length - 1;
        }
    }

    function pushUndo(doc, beforeText, label) {
        if (!doc) return;
        if (!Array.isArray(doc.undo)) doc.undo = [];
        doc.undo.push({ ts: Date.now(), text: String(beforeText ?? ''), label: String(label || 'edit') });
        while (doc.undo.length > 8) doc.undo.shift();
        // Also cap total backup weight so settings.json stays sane.
        let total = doc.undo.reduce((n, u) => n + (u.text ? u.text.length : 0), 0);
        while (doc.undo.length > 1 && total > 400000) {
            total -= (doc.undo[0].text || '').length;
            doc.undo.shift();
        }
    }

    // ------------------------------------------------------------------
    // Reply parsing: the <docedits> block
    // ------------------------------------------------------------------

    // Models mention the tag name in prose ("no docedits needed here"), which
    // poisons naive first-match regexes. Take the LAST opening tag that has a
    // closing tag after it, preferring the candidate whose inner content looks
    // like JSON ([ { or a code fence); fall back to the last valid span.
    function findBlock(text, tag) {
        const src = String(text || '');
        const low = src.toLowerCase();
        const openTag = '<' + tag + '>';
        const closeTag = '</' + tag + '>';
        const opens = [];
        let oi = low.indexOf(openTag);
        while (oi !== -1) { opens.push(oi); oi = low.indexOf(openTag, oi + 1); }
        if (!opens.length) return null;
        let fallback = null;
        for (let k = opens.length - 1; k >= 0; k--) {
            const start = opens[k];
            const innerStart = start + openTag.length;
            const close = low.indexOf(closeTag, innerStart);
            if (close === -1) continue;
            const inner = src.slice(innerStart, close);
            const cand = { inner, start, end: close + closeTag.length };
            if (/^\s*(\[|\{|```)/.test(inner)) return cand;
            if (!fallback) fallback = cand;
        }
        return fallback;
    }

    function parseDocEdits(text) {
        const b = findBlock(text, 'docedits');
        if (!b) return { edits: [] };
        let raw = b.inner.trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/```\s*$/, '')
            .trim();
        let arr = null;
        try {
            arr = JSON.parse(raw);
        } catch (e1) {
            // One gentle repair pass: kill trailing commas, then retry.
            try { arr = JSON.parse(raw.replace(/,\s*([\]}])/g, '$1')); }
            catch (e2) { return { edits: [], error: 'could not parse docedits JSON: ' + e2.message }; }
        }
        if (!Array.isArray(arr)) return { edits: [], error: 'docedits block is not a JSON array' };
        const edits = [];
        for (const e of arr) {
            if (!e || typeof e !== 'object') continue;
            const replace = String(e.replace ?? '');
            const reason = String(e.reason ?? '');
            if (e.replace_all === true) { edits.push({ type: 'replace_all', find: null, replace, reason, status: 'pending' }); continue; }
            if (e.append === true) { edits.push({ type: 'append', find: null, replace, reason, status: 'pending' }); continue; }
            if (typeof e.insert_after === 'string' && e.insert_after.length) { edits.push({ type: 'insert', find: e.insert_after, replace, reason, status: 'pending' }); continue; }
            if (typeof e.find === 'string' && e.find.length) { edits.push({ type: 'replace', find: e.find, replace, reason, status: 'pending' }); continue; }
            // Unknown shape — skip silently rather than crash or half-apply.
        }
        return { edits };
    }

    // Remove the chosen block span from display text (same span logic as the
    // parser, so a prose mention can never desync display from application).
    function stripBlocks(text) {
        let out = String(text || '');
        const b = findBlock(out, 'docedits');
        if (b) out = out.slice(0, b.start) + '[proposed edits below]' + out.slice(b.end);
        return out.trim();
    }

    function splitThinking(text) {
        let think = '';
        let rest = String(text || '').replace(/<(think|thinking|reasoning)>([\s\S]*?)<\/\1>/gi, (m0, tag, body) => {
            const b = String(body).trim();
            if (b) think += (think ? '\n\n' : '') + b;
            return '';
        });
        // Unclosed leading tag (mid-stream or model forgot to close): treat the
        // remainder as thinking so it can never leak into parsing/history.
        const open = rest.match(/<(think|thinking|reasoning)>/i);
        if (open && rest.indexOf('</' + open[1].toLowerCase(), open.index) === -1) {
            const tail = rest.slice(open.index + open[0].length).trim();
            if (tail) think += (think ? '\n\n' : '') + tail;
            rest = rest.slice(0, open.index);
        }
        return { rest: rest.trim(), think: think.trim() };
    }

    // ------------------------------------------------------------------
    // Locating text inside the document (exact -> normalized -> fuzzy)
    // ------------------------------------------------------------------

    function normChars(s) {
        // 1:1 length-preserving normalization, so indices stay valid on the original.
        return String(s)
            .replace(/[\u2018\u2019\u201A\u201B\u02BC]/g, "'")
            .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
            .replace(/[\u2013\u2014\u2010\u2011]/g, '-')
            .replace(/\u00A0/g, ' ');
    }

    function levenshtein(a, b) {
        // Works on strings and on arrays of words alike.
        const m = a.length, n = b.length;
        if (!m) return n;
        if (!n) return m;
        let prev = new Array(n + 1);
        let cur = new Array(n + 1);
        for (let j = 0; j <= n; j++) prev[j] = j;
        for (let i = 1; i <= m; i++) {
            cur[0] = i;
            const ai = a[i - 1];
            for (let j = 1; j <= n; j++) {
                const cost = ai === b[j - 1] ? 0 : 1;
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            }
            const tmp = prev; prev = cur; cur = tmp;
        }
        return prev[n];
    }

    function locate(hay, needle) {
        hay = String(hay ?? '');
        needle = String(needle ?? '');
        if (!needle) return null;

        // 1) exact (with occurrence count so the card can warn on ambiguity)
        let idx = hay.indexOf(needle);
        if (idx >= 0) {
            let count = 1;
            let p = hay.indexOf(needle, idx + needle.length);
            while (p !== -1 && count < 9) { count++; p = hay.indexOf(needle, p + needle.length); }
            return { start: idx, end: idx + needle.length, fuzzy: false, count };
        }

        // 2) quote/dash/nbsp-normalized exact (length-preserving, indices map 1:1)
        const hay2 = normChars(hay);
        const needle2 = normChars(needle);
        idx = hay2.indexOf(needle2);
        if (idx >= 0) return { start: idx, end: idx + needle2.length, fuzzy: false, count: 1 };

        // 3) fuzzy sliding window over words (Levenshtein on word arrays).
        // Documents can be 30k+ chars, so a brute-force scan of every start is
        // too slow — first collect candidate starts by alignment voting (each
        // needle word votes for the start positions that would line it up),
        // then run the word-Levenshtein only on those.
        const tokens = [...hay2.matchAll(/\S+/g)];
        const needleWords = needle2.split(/\s+/).filter(Boolean).map(w => w.toLowerCase());
        const nw = needleWords.length;
        if (!tokens.length || nw < 3 || nw > 150) return null;
        const hayWords = tokens.map(t => t[0].toLowerCase());
        const widths = [...new Set([
            Math.max(1, Math.round(nw * 0.85)),
            Math.max(1, nw - 1),
            nw,
            nw + 1,
            Math.round(nw * 1.15),
        ])].filter(w => w >= 1 && w <= hayWords.length);

        const posIndex = new Map();
        for (let i = 0; i < hayWords.length; i++) {
            const w = hayWords[i];
            let a = posIndex.get(w);
            if (!a) { a = []; posIndex.set(w, a); }
            a.push(i);
        }
        const votes = new Map();
        for (let k = 0; k < nw; k++) {
            const arr = posIndex.get(needleWords[k]);
            if (!arr || arr.length > 400) continue; // skip ultra-common words
            for (const p of arr) {
                const s = p - k;
                if (s >= 0 && s < hayWords.length) votes.set(s, (votes.get(s) || 0) + 1);
            }
        }
        const minVotes = Math.max(2, Math.ceil(nw * 0.3));
        const ranked = [...votes.entries()]
            .filter(([, v]) => v >= minVotes)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 60);
        const startSet = new Set();
        for (const [s] of ranked) {
            for (let d = -2; d <= 2; d++) {
                const v = s + d;
                if (v >= 0 && v < hayWords.length) startSet.add(v);
            }
        }
        if (!startSet.size) {
            // Nothing voted (e.g. every word too common) — brute force is only
            // acceptable on small documents, same cap Continuity Copilot used.
            if (hayWords.length > 4000) return null;
            for (let s = 0; s < hayWords.length; s++) startSet.add(s);
        }

        let best = null;
        for (const s of startSet) {
            for (const w of widths) {
                if (s + w > hayWords.length) continue;
                const cand = hayWords.slice(s, s + w);
                const dist = levenshtein(cand, needleWords);
                const sim = 1 - dist / Math.max(cand.length, nw);
                if (!best || sim > best.sim) best = { sim, s, w };
            }
        }
        if (best && best.sim >= 0.78) {
            const st = tokens[best.s];
            const en = tokens[best.s + best.w - 1];
            return { start: st.index, end: en.index + en[0].length, fuzzy: true, sim: best.sim, count: 1 };
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Applying edits to the document text
    // ------------------------------------------------------------------

    function applyEditToText(text, edit) {
        text = String(text ?? '');
        const rep = String(edit.replace ?? '');

        if (edit.type === 'replace_all') {
            if (rep === text) return { ok: false, reason: 'no change produced' };
            return { ok: true, text: rep, note: '' };
        }
        if (edit.type === 'append') {
            const base = text.replace(/\s+$/, '');
            const next = base.length ? (base + '\n\n' + rep + '\n') : (rep + '\n');
            if (next === text) return { ok: false, reason: 'no change produced' };
            return { ok: true, text: next, note: '' };
        }

        const needle = String(edit.find || '');
        if (!needle) return { ok: false, reason: 'missing find/anchor text' };
        const loc = locate(text, needle);
        if (!loc) {
            const what = edit.type === 'insert' ? 'insert_after anchor' : '"find" text';
            return { ok: false, reason: what + ' not located (even fuzzy) — ask the agent to resend it copied verbatim' };
        }
        let note = loc.fuzzy ? ' (fuzzy ' + Math.round(loc.sim * 100) + '%)' : '';
        let next;
        if (edit.type === 'insert') {
            // Insert on a new line after the END of the line containing the anchor.
            let ip = text.indexOf('\n', loc.end);
            if (ip === -1) ip = text.length;
            next = text.slice(0, ip) + '\n' + rep + text.slice(ip);
        } else {
            next = text.slice(0, loc.start) + rep + text.slice(loc.end);
            if (!loc.fuzzy && loc.count > 1) note += ' (matched 1 of ' + loc.count + ' occurrences)';
        }
        if (next === text) return { ok: false, reason: 'no change produced' };
        return { ok: true, text: next, note };
    }

    function applyEdits(list) {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const todo = (list || []).filter(e => e && e.status === 'pending');
        if (!todo.length) { renderEditCards(); return; }

        let text = String(doc.text || '');
        const before = text;
        const applied = [];
        for (const edit of todo) {
            const res = applyEditToText(text, edit);
            if (res.ok) {
                text = res.text;
                edit.status = 'applied' + (res.note || '');
                applied.push(edit);
            } else {
                edit.status = 'failed: ' + res.reason;
            }
        }
        if (applied.length) {
            pushUndo(doc, before, applied.length + ' edit(s)');
            doc.text = text;
            doc.updated = Date.now();
            persist();
            const note = 'Applied ' + applied.length + ' edit(s) to "' + doc.name + '".';
            pushHistory(doc, 'note', note);
            renderHistory();
            syncOpenDocEditor(doc, before);
            updateSub();
            toast(note, 'success');
        }
        renderEditCards();
    }

    function undoLast() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const u = Array.isArray(doc.undo) ? doc.undo.pop() : null;
        if (!u) { toast('Nothing to undo for this document.', 'warning'); return; }
        const before = String(doc.text || '');
        doc.text = String(u.text ?? '');
        doc.updated = Date.now();
        persist();
        const note = 'Undid last applied batch (' + (u.label || 'edit') + ') on "' + doc.name + '".';
        pushHistory(doc, 'note', note);
        renderHistory();
        syncOpenDocEditor(doc, before);
        updateSub();
        toast(note, 'success');
    }

    // ------------------------------------------------------------------
    // LLM routing (Connection Profile via ConnectionManagerRequestService,
    // raw generateRaw fallback) — same battle-tested path as Continuity Copilot
    // ------------------------------------------------------------------

    function getProfiles() {
        try {
            const list = ctx().extensionSettings?.connectionManager?.profiles;
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    function extractText(res) {
        if (res == null) return '';
        if (typeof res === 'string') return res;
        if (typeof res.content === 'string') return res.content;
        if (Array.isArray(res.content)) {
            return res.content.map(p => (typeof p === 'string' ? p : (p?.text || ''))).join('');
        }
        if (typeof res.text === 'string') return res.text;
        try { return JSON.stringify(res); } catch (e) { return String(res); }
    }

    function grow(acc, chunk) {
        // Handles both cumulative and delta streaming chunks.
        if (!chunk) return acc;
        return chunk.startsWith(acc) ? chunk : acc + chunk;
    }

    async function callLLM(messages, onPartial) {
        const c = ctx();
        const pid = settings.profileId;
        const maxTok = Number(settings.maxTokens) || 4096;
        stopRequested = false;
        try { abortCtl = new AbortController(); } catch (e) { abortCtl = null; }

        if (pid && c.ConnectionManagerRequestService?.sendRequest) {
            if (settings.streaming) {
                try {
                    const res = await c.ConnectionManagerRequestService.sendRequest(pid, messages, maxTok, { stream: true, signal: abortCtl?.signal });
                    if (typeof res === 'function') {
                        let acc = '';
                        let reasoning = '';
                        try {
                            for await (const chunk of res()) {
                                if (stopRequested) break;
                                if (typeof chunk === 'string') {
                                    acc = grow(acc, chunk);
                                } else {
                                    acc = grow(acc, String(chunk?.text ?? ''));
                                    const r = chunk?.state?.reasoning ?? chunk?.reasoning;
                                    if (typeof r === 'string') reasoning = grow(reasoning, r);
                                }
                                if (onPartial) onPartial(acc, reasoning);
                            }
                        } catch (se) { if (!stopRequested) throw se; }
                        if (reasoning && !/<think|<reasoning/i.test(acc)) {
                            return '<think>' + reasoning + '</think>\n' + acc;
                        }
                        return acc;
                    }
                    return extractText(res);
                } catch (e) {
                    console.warn(LOG, 'streaming failed, retrying without stream', e);
                }
            }
            try {
                const res = await c.ConnectionManagerRequestService.sendRequest(pid, messages, maxTok, { signal: abortCtl?.signal });
                return extractText(res);
            } catch (se) {
                if (stopRequested) return '';
                throw se;
            }
        }

        // Fallback: current connection, raw generation (no streaming here).
        const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const convo = messages
            .filter(m => m.role !== 'system')
            .map(m => (m.role === 'user' ? '[User]\n' : '[Agent]\n') + m.content)
            .join('\n\n') + '\n\n[Agent]\n';
        if (typeof c.generateRaw === 'function') {
            try {
                const res = await c.generateRaw({ prompt: convo, systemPrompt: sys });
                return extractText(res);
            } catch (se) {
                if (stopRequested) return '';
                throw se;
            }
        }
        throw new Error('No generation backend found. Pick a Connection Profile in the panel settings (gear icon).');
    }

    function requestStop() {
        if (!running) return;
        stopRequested = true;
        try { abortCtl?.abort(); } catch (e) { /* ignore */ }
        try { ctx().stopGeneration?.(); } catch (e) { /* ignore */ }
        toast('Stopping\u2026', 'info');
    }

    // ------------------------------------------------------------------
    // Building the request: preset + protocol as system, then conversation,
    // with the FULL document injected into the LAST user message (recency
    // helps verbatim copying). Documents are sent whole, never truncated.
    // ------------------------------------------------------------------

    function docBlock(doc) {
        const body = String(doc.text || '');
        return '[DOCUMENT: ' + (doc.name || 'Untitled') + ']\n'
            + (body.length ? body : '(the document is currently empty)')
            + '\n[/DOCUMENT]';
    }

    function buildMessages(doc, uptoIdx) {
        const preset = presetForDoc(doc);
        const sys = String(preset?.prompt || '').trim() + '\n\n' + DOCEDITS_PROTOCOL;
        const msgs = [{ role: 'system', content: sys }];

        const depth = Math.max(2, Number(settings.historyDepth) || 16);
        const base = (Number.isInteger(uptoIdx) ? doc.history.slice(0, uptoIdx) : doc.history.slice()).slice(-depth);

        let lastUser = -1;
        for (let i = base.length - 1; i >= 0; i--) {
            if (base[i].role === 'user') { lastUser = i; break; }
        }
        base.forEach((h, i) => {
            let content = String(h.content ?? '');
            if (h.role === 'note') { msgs.push({ role: 'user', content: '[STATE] ' + content }); return; }
            if (i === lastUser) content = docBlock(doc) + '\n\n' + content;
            msgs.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content });
        });
        return msgs;
    }

    // ------------------------------------------------------------------
    // Conversation flow
    // ------------------------------------------------------------------

    async function send(userText) {
        userText = String(userText || '').trim();
        if (!userText || running) return;
        const doc = activeDoc();
        if (!doc) { toast('Create or import a document first (+ New).', 'warning'); return; }
        pushHistory(doc, 'user', userText);
        renderHistory(true);
        await runGeneration();
    }

    async function runGeneration(opts = {}) {
        if (running) return;
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        running = true;
        setBusy(true);
        const docAtStart = doc.id;
        const busy = addBubble('busy', Number.isInteger(opts.swipeIdx)
            ? 'regenerating \u2014 new alternative (old answer kept as a swipe)\u2026'
            : 'thinking\u2026');
        const live = (acc, reasoning) => {
            const log = el('la_log');
            const pinned = !log || (log.scrollHeight - log.scrollTop - log.clientHeight) < 60;
            const head = (settings.showThinking && reasoning) ? '[thinking]\n' + reasoning + '\n\n' : '';
            const shown = (head + acc).trim();
            if (shown) busy.className = 'la_bubble la_ai';
            busy.innerHTML = esc(shown.slice(-3500) || 'thinking\u2026');
            if (log && pinned) log.scrollTop = log.scrollHeight;
        };
        try {
            const messages = buildMessages(doc, opts.swipeIdx);
            const raw = await callLLM(messages, live);
            const split = splitThinking(raw);
            let reply = split.rest;
            const think = split.think;

            busy.remove();
            if (activeDoc()?.id !== docAtStart) {
                addBubble('note', 'Reply discarded \u2014 document switched during generation.');
                return;
            }
            if (stopRequested) {
                if (!reply && !think) {
                    const n = 'Generation stopped \u2014 nothing received.';
                    pushHistory(doc, 'note', n);
                    renderHistory();
                    return;
                }
                reply = (reply ? reply + '\n\n' : '') + '[stopped \u2014 partial reply kept]';
            }

            if (Number.isInteger(opts.swipeIdx)) {
                const entry = doc.history[opts.swipeIdx];
                if (entry && entry.role === 'assistant') {
                    ensureSwipes(entry);
                    entry.swipes.push({ content: reply, think: think || '' });
                    entry.swipeId = entry.swipes.length - 1;
                    entry.content = reply;
                    entry.think = think || '';
                    persist();
                }
            } else {
                pushHistory(doc, 'assistant', reply, think);
            }
            renderHistory();

            const parsed = parseDocEdits(reply);
            if (parsed.error) {
                addBubble('note', 'docedits error: ' + parsed.error + ' \u2014 ask the agent to resend valid JSON.');
            }
            if (parsed.edits.length) {
                editsCollapsed = false;
                pendingEdits = parsed.edits;
                renderEditCards();
            }
        } catch (err) {
            busy.remove();
            console.error(LOG, err);
            addBubble('note', 'Error: ' + (err?.message || err));
            toast(String(err?.message || err), 'error');
        } finally {
            running = false;
            setBusy(false);
        }
    }

    async function swipeAssistant(idx, dir) {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        const h = doc.history;
        const entry = h[idx];
        if (!entry || entry.role !== 'assistant' || idx !== h.length - 1) return;
        ensureSwipes(entry);
        const target = entry.swipeId + dir;
        if (target < 0) return;
        if (target < entry.swipes.length) {
            entry.swipeId = target;
            entry.content = entry.swipes[target].content;
            entry.think = entry.swipes[target].think || '';
            persist();
            renderHistory();
            const pe = parseDocEdits(entry.content);
            editsCollapsed = false;
            pendingEdits = pe.edits;
            renderEditCards();
            return;
        }
        await runGeneration({ swipeIdx: idx });
    }

    async function retryLast() {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        const h = doc.history;
        let i = h.length - 1;
        while (i >= 0 && h[i].role !== 'assistant') i--;
        if (i === h.length - 1 && i >= 0) { await swipeAssistant(i, +1); return; }
        // No assistant at the end: if there is a dangling user message
        // (e.g. after an error), just generate for it.
        if (h.length && h[h.length - 1].role === 'user') { await runGeneration(); return; }
        if (i < 0) { toast('Nothing to retry yet.', 'warning'); return; }
        h.splice(i);
        persist();
        pendingEdits = [];
        renderHistory();
        renderEditCards();
        await runGeneration();
    }

    function deleteLastExchange() {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        const h = doc.history;
        let i = h.length - 1;
        while (i >= 0 && h[i].role !== 'user') i--;
        if (i < 0) { toast('Nothing to delete.', 'warning'); return; }
        h.splice(i);
        persist();
        pendingEdits = [];
        renderHistory();
        renderEditCards();
    }

    function startEditUserMessage(idx) {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        const h = doc.history;
        if (!h[idx] || h[idx].role !== 'user') return;
        if (idx < h.length - 1 && !confirm('Edit this message? Everything after it in this conversation will be removed.')) return;
        const text = h[idx].content;
        h.splice(idx);
        persist();
        pendingEdits = [];
        renderHistory();
        renderEditCards();
        const input = el('la_input');
        if (input) { input.value = text; input.focus(); }
        addBubble('note', 'Editing \u2014 press Send to continue from here.');
    }

    function deleteMessageAt(idx) {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        const h = doc.history;
        if (!h[idx]) return;
        if (!confirm('Delete this message from the agent conversation?')) return;
        h.splice(idx, 1);
        persist();
        pendingEdits = [];
        renderHistory();
        renderEditCards();
    }

    function clearConversation() {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        if (!confirm('Clear the agent conversation for "' + doc.name + '"? The document itself is untouched.')) return;
        doc.history = [];
        persist();
        pendingEdits = [];
        renderHistory();
        renderEditCards();
    }

    // ------------------------------------------------------------------
    // Draggable floating editor window (fully inline-styled: a stale cached
    // CSS file must never be able to break this — learned the hard way)
    // ------------------------------------------------------------------

    function makeDraggable(box, handle) {
        let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
        try { handle.style.touchAction = 'none'; } catch (e) { /* ignore */ }
        handle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button, select, input, textarea, a, .la_hbtn')) return;
            dragging = true;
            sx = e.clientX; sy = e.clientY;
            const r = box.getBoundingClientRect();
            ox = r.left; oy = r.top;
            handle.setPointerCapture?.(e.pointerId);
        });
        handle.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const nx = Math.min(Math.max(0, ox + e.clientX - sx), window.innerWidth - 80);
            const ny = Math.min(Math.max(0, oy + e.clientY - sy), window.innerHeight - 40);
            box.style.left = nx + 'px';
            box.style.top = ny + 'px';
            box.style.right = 'auto';
            box.style.bottom = 'auto';
        });
        const stop = () => { dragging = false; };
        handle.addEventListener('pointerup', stop);
        handle.addEventListener('pointercancel', stop);
    }

    // showEditor({title, text, saveLabel, showName, nameValue, bound, onSave})
    // onSave(text, name) — the one editor window is reused for: View/Edit
    // document, Edit preset prompt (20k+ chars must stay smooth), Import.
    function showEditor(opts) {
        opts = opts || {};
        let backdrop = el('la_viewer');
        let box = el('la_viewer_win');
        if (box && box.style.display !== 'none') {
            const taOpen = el('la_viewer_ta');
            if (taOpen && taOpen.value !== box._snapshot
                && !confirm('The editor window has unsaved changes. Replace its contents anyway?')) return;
        }
        if (!box) {
            backdrop = document.createElement('div');
            backdrop.id = 'la_viewer';
            backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;display:none;background:rgba(0,0,0,0.5);';
            document.body.appendChild(backdrop);

            box = document.createElement('div');
            box.id = 'la_viewer_win';
            box.style.cssText = 'position:fixed;z-index:9999;display:none;flex-direction:column;border-radius:10px;border:1px solid rgba(255,255,255,0.3);background:#1e1e1e;color:#dddddd;box-shadow:0 8px 30px rgba(0,0,0,0.6);overflow:hidden;';

            const head = document.createElement('div');
            head.id = 'la_viewer_head';
            head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.2);flex:0 0 auto;cursor:move;user-select:none;touch-action:none;background:rgba(255,255,255,0.05);flex-wrap:wrap;';

            const titleEl = document.createElement('span');
            titleEl.id = 'la_viewer_title';
            titleEl.style.cssText = 'flex:1 1 auto;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:120px;';

            const countEl = document.createElement('span');
            countEl.id = 'la_viewer_count';
            countEl.style.cssText = 'flex:0 0 auto;opacity:0.65;font-size:0.8em;';

            const btnStyle = 'cursor:pointer;border:1px solid rgba(255,255,255,0.35);background:rgba(255,255,255,0.10);color:inherit;border-radius:6px;padding:8px 14px;font-size:0.9em;flex:0 0 auto;';
            const pasteBtn = document.createElement('button');
            pasteBtn.id = 'la_viewer_paste';
            pasteBtn.textContent = 'Paste';
            pasteBtn.title = 'Append clipboard text (needs clipboard permission; on http just long-press the text box and paste manually)';
            pasteBtn.style.cssText = btnStyle;
            const copyBtn = document.createElement('button');
            copyBtn.id = 'la_viewer_copy';
            copyBtn.textContent = 'Copy';
            copyBtn.style.cssText = btnStyle;
            const saveBtn = document.createElement('button');
            saveBtn.id = 'la_viewer_save';
            saveBtn.textContent = 'Save';
            saveBtn.style.cssText = btnStyle + 'background:rgba(80,200,120,0.3);';
            const closeBtn = document.createElement('button');
            closeBtn.id = 'la_viewer_close';
            closeBtn.textContent = 'Close';
            closeBtn.style.cssText = btnStyle + 'background:rgba(220,90,90,0.3);';

            head.appendChild(titleEl);
            head.appendChild(countEl);
            head.appendChild(pasteBtn);
            head.appendChild(copyBtn);
            head.appendChild(saveBtn);
            head.appendChild(closeBtn);

            const nameRow = document.createElement('div');
            nameRow.id = 'la_viewer_namerow';
            nameRow.style.cssText = 'display:none;flex:0 0 auto;padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.15);gap:6px;align-items:center;';
            const nameLbl = document.createElement('span');
            nameLbl.textContent = 'Name:';
            nameLbl.style.cssText = 'flex:0 0 auto;font-size:0.85em;opacity:0.8;';
            const nameIn = document.createElement('input');
            nameIn.id = 'la_viewer_name';
            nameIn.type = 'text';
            nameIn.style.cssText = 'flex:1 1 auto;min-width:0;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.25);border-radius:5px;padding:6px 8px;font-size:0.9em;';
            nameRow.appendChild(nameLbl);
            nameRow.appendChild(nameIn);

            const ta = document.createElement('textarea');
            ta.id = 'la_viewer_ta';
            ta.spellcheck = false;
            ta.style.cssText = 'flex:1 1 auto;margin:0;padding:10px;background:rgba(0,0,0,0.25);color:inherit;border:none;outline:none;resize:none;font-size:0.85em;font-family:monospace;line-height:1.4;white-space:pre-wrap;box-sizing:border-box;width:100%;';

            box.appendChild(head);
            box.appendChild(nameRow);
            box.appendChild(ta);
            document.body.appendChild(box);

            const updateCount = () => { countEl.textContent = ta.value.length.toLocaleString() + ' chars'; };
            ta.addEventListener('input', updateCount);
            box._updateCount = updateCount;

            const doClose = () => {
                if (ta.value !== box._snapshot && !confirm('Close without saving? Changes in this window will be lost.')) return;
                backdrop.style.display = 'none';
                box.style.display = 'none';
                box._bound = null;
            };
            closeBtn.addEventListener('click', doClose);
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && box.style.display !== 'none') doClose();
            });
            // Deliberately NOT closing on backdrop tap: a stray tap must never
            // eat a 20k-char paste. Close button or Esc only.

            copyBtn.addEventListener('click', async () => {
                const ok = await copyText(ta.value);
                toast(ok ? 'Copied to clipboard.' : 'Copy failed \u2014 select the text manually.', ok ? 'success' : 'error');
            });
            pasteBtn.addEventListener('click', async () => {
                try {
                    const t = await navigator.clipboard.readText();
                    if (!t) { toast('Clipboard is empty or unreadable.', 'warning'); return; }
                    ta.value = ta.value ? (ta.value.replace(/\s+$/, '') + '\n' + t) : t;
                    updateCount();
                    toast('Pasted ' + t.length.toLocaleString() + ' chars from clipboard.', 'success');
                } catch (e) {
                    toast('Clipboard read blocked (normal on http/LAN) \u2014 long-press the text box and paste manually.', 'warning');
                }
            });
            saveBtn.addEventListener('click', () => {
                const cb = box._onSave;
                box._snapshot = ta.value;
                if (typeof cb === 'function') cb(ta.value, el('la_viewer_name')?.value ?? '');
                if (box._closeOnSave) {
                    backdrop.style.display = 'none';
                    box.style.display = 'none';
                    box._bound = null;
                }
            });

            makeDraggable(box, head);
        }

        // Snap to a safe on-screen spot and size EVERY time it opens, so it
        // can never get stranded off-screen (Android WebView lesson).
        box.style.left = '2vw';
        box.style.top = '60px';
        box.style.right = 'auto';
        box.style.bottom = 'auto';
        box.style.width = '96vw';
        box.style.height = '72vh';

        el('la_viewer_title').textContent = String(opts.title || 'Editor') + ' \u2014 v' + VERSION;
        const nameRowEl = el('la_viewer_namerow');
        nameRowEl.style.display = opts.showName ? 'flex' : 'none';
        el('la_viewer_name').value = String(opts.nameValue || '');
        const ta = el('la_viewer_ta');
        ta.value = String(opts.text ?? '');
        el('la_viewer_save').textContent = String(opts.saveLabel || 'Save');
        box._onSave = (typeof opts.onSave === 'function') ? opts.onSave : null;
        box._closeOnSave = !!opts.closeOnSave;
        box._bound = opts.bound || null;
        box._snapshot = ta.value;
        box._updateCount();
        backdrop.style.display = 'block';
        box.style.display = 'flex';
    }

    // After Apply/Undo: if the editor window is open on this document and the
    // user has not typed into it, refresh it so it shows the new text.
    function syncOpenDocEditor(doc, beforeText) {
        const box = el('la_viewer_win');
        if (!box || box.style.display === 'none') return;
        const b = box._bound;
        if (!b || b.kind !== 'doc' || b.id !== doc.id) return;
        const ta = el('la_viewer_ta');
        if (ta.value !== beforeText && ta.value !== box._snapshot) return; // user edited — leave it alone
        ta.value = String(doc.text || '');
        box._snapshot = ta.value;
        box._updateCount();
    }

    // ------------------------------------------------------------------
    // Document actions
    // ------------------------------------------------------------------

    function newDoc() {
        const v = prompt('Name for the new document:', 'Untitled');
        if (v === null) return;
        const d = makeDoc(v.trim() || 'Untitled', '');
        settings.docs.push(d);
        setActiveDoc(d.id);
        persist();
        renderAll();
        toast('Created "' + d.name + '".', 'success');
    }

    function renameDoc() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const v = prompt('Rename document:', doc.name);
        if (v === null) return;
        doc.name = v.trim() || doc.name;
        doc.updated = Date.now();
        persist();
        renderAll();
    }

    function dupDoc() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const d = makeDoc(doc.name + ' (copy)', doc.text);
        d.presetId = doc.presetId;
        settings.docs.push(d);
        setActiveDoc(d.id);
        persist();
        renderAll();
        toast('Duplicated to "' + d.name + '" (fresh conversation).', 'success');
    }

    function deleteDoc() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        if (!confirm('Delete document "' + doc.name + '" (' + (doc.text || '').length.toLocaleString() + ' chars) and its conversation? This cannot be undone.')) return;
        settings.docs = settings.docs.filter(d => d.id !== doc.id);
        setActiveDoc(settings.docs[0]?.id || '');
        persist();
        renderAll();
        toast('Deleted "' + doc.name + '".', 'info');
    }

    function importDoc() {
        showEditor({
            title: '\uD83D\uDCE5 Import document',
            text: '',
            showName: true,
            nameValue: 'Imported',
            saveLabel: 'Create document',
            closeOnSave: true,
            onSave: (text, name) => {
                const d = makeDoc((name || '').trim() || 'Imported', text);
                settings.docs.push(d);
                setActiveDoc(d.id);
                persist();
                renderAll();
                toast('Imported "' + d.name + '" (' + d.text.length.toLocaleString() + ' chars).', 'success');
            },
        });
    }

    function exportDoc() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const ok = downloadText(doc.name, doc.text);
        toast(ok ? 'Downloading "' + safeFileName(doc.name) + '.md"\u2026' : 'Download failed \u2014 use Copy instead.', ok ? 'success' : 'error');
    }

    async function copyDoc() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const ok = await copyText(doc.text || '');
        toast(ok ? 'Document copied (' + (doc.text || '').length.toLocaleString() + ' chars).' : 'Copy failed \u2014 open View and select manually.', ok ? 'success' : 'error');
    }

    function viewDoc() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        showEditor({
            title: '\uD83D\uDCC4 ' + doc.name,
            text: doc.text,
            saveLabel: 'Save',
            bound: { kind: 'doc', id: doc.id },
            onSave: (text) => {
                const d = settings.docs.find(x => x.id === doc.id);
                if (!d) { toast('Document no longer exists.', 'error'); return; }
                if (text === d.text) { toast('No changes.', 'info'); return; }
                pushUndo(d, d.text, 'manual edit');
                d.text = text;
                d.updated = Date.now();
                persist();
                updateSub();
                toast('Saved "' + d.name + '" (' + text.length.toLocaleString() + ' chars).', 'success');
            },
        });
    }

    // ------------------------------------------------------------------
    // Preset actions (the drawer targets the ACTIVE document's preset)
    // ------------------------------------------------------------------

    function isSeedPreset(id) {
        return id === PRESET_PE_ID || id === PRESET_AI_ID;
    }

    function newPreset() {
        const v = prompt('Name for the new preset:', 'New preset');
        if (v === null) return;
        const p = { id: uid(), name: v.trim() || 'New preset', prompt: '' };
        settings.presets.push(p);
        const doc = activeDoc();
        if (doc) doc.presetId = p.id;
        persist();
        renderAll();
        editPreset(p.id);
    }

    function renamePreset() {
        const p = presetForDoc(activeDoc());
        if (!p) { toast('No preset available.', 'warning'); return; }
        const v = prompt('Rename preset:', p.name);
        if (v === null) return;
        p.name = v.trim() || p.name;
        persist();
        renderAll();
    }

    function deletePreset() {
        const p = presetForDoc(activeDoc());
        if (!p) { toast('No preset available.', 'warning'); return; }
        if (isSeedPreset(p.id)) {
            toast('Built-in presets cannot be deleted \u2014 use "Reset default" to restore the placeholder.', 'warning');
            return;
        }
        if (!confirm('Delete preset "' + p.name + '"? Documents using it fall back to "Plot Essential Maker".')) return;
        settings.presets = settings.presets.filter(x => x.id !== p.id);
        for (const d of settings.docs) {
            if (d.presetId === p.id) d.presetId = PRESET_PE_ID;
        }
        persist();
        renderAll();
        toast('Deleted preset "' + p.name + '".', 'info');
    }

    function resetPreset() {
        const p = presetForDoc(activeDoc());
        if (!p) { toast('No preset available.', 'warning'); return; }
        if (!isSeedPreset(p.id)) { toast('Only the two built-in presets have a default to reset to.', 'warning'); return; }
        if (!confirm('Reset "' + p.name + '" to its default placeholder prompt? Your current prompt text in it will be lost.')) return;
        p.prompt = DEFAULT_PRESET_PROMPTS[p.id];
        persist();
        renderAll();
        toast('Preset reset to default.', 'success');
    }

    function editPreset(id) {
        const p = id ? presetById(id) : presetForDoc(activeDoc());
        if (!p) { toast('No preset available.', 'warning'); return; }
        showEditor({
            title: '\uD83E\uDDE0 Preset: ' + p.name,
            text: p.prompt,
            saveLabel: 'Save preset',
            bound: { kind: 'preset', id: p.id },
            onSave: (text) => {
                const cur = presetById(p.id);
                if (!cur) { toast('Preset no longer exists.', 'error'); return; }
                cur.prompt = text;
                persist();
                refreshPresetTools();
                toast('Saved preset "' + cur.name + '" (' + text.length.toLocaleString() + ' chars). Takes effect on the next message.', 'success');
            },
        });
    }

    // ------------------------------------------------------------------
    // Panel UI
    // ------------------------------------------------------------------

    function buildPanel() {
        if (el('la_panel')) return;
        const panel = document.createElement('div');
        panel.id = 'la_panel';
        panel.innerHTML = [
            '<div id="la_header">',
            '  <span class="la_title">\uD83D\uDCDC Lore Agent</span>',
            '  <span class="la_sub" id="la_sub"></span>',
            '  <span class="la_hbtn" id="la_gear" title="Settings"><i class="fa-solid fa-gear"></i></span>',
            '  <span class="la_hbtn" id="la_close" title="Close"><i class="fa-solid fa-xmark"></i></span>',
            '</div>',
            '<div id="la_docbar">',
            '  <div class="la_dbrow">',
            '    <select id="la_doc" title="Active document"></select>',
            '    <select id="la_preset" title="Agent preset (brain) for this document"></select>',
            '  </div>',
            '  <div class="la_dbrow la_dbbtns">',
            '    <button class="la_btn" id="la_new" title="New empty document">+ New</button>',
            '    <button class="la_btn" id="la_dren" title="Rename document">Ren</button>',
            '    <button class="la_btn" id="la_dup" title="Duplicate document (text + preset, fresh conversation)">Dup</button>',
            '    <button class="la_btn" id="la_ddel" title="Delete document">Del</button>',
            '    <button class="la_btn" id="la_imp" title="Import: paste text into an editor window">Imp</button>',
            '    <button class="la_btn" id="la_exp" title="Export: download as .md">Exp</button>',
            '    <button class="la_btn" id="la_dcopy" title="Copy the whole document to the clipboard">\uD83D\uDCCB</button>',
            '    <button class="la_btn" id="la_view" title="View/Edit the document in a window">View</button>',
            '  </div>',
            '</div>',
            '<div id="la_settings"></div>',
            '<div id="la_log"></div>',
            '<div id="la_edits"></div>',
            '<div id="la_composer">',
            '  <div id="la_quick">',
            '    <button class="la_btn" id="la_retry" title="Regenerate the last agent reply (kept as a swipe)">Retry</button>',
            '    <button class="la_btn" id="la_dellast" title="Delete the last question + answer">Del last</button>',
            '    <button class="la_btn" id="la_undo" title="Undo the last applied batch / manual save on this document">Undo</button>',
            '    <button class="la_btn" id="la_clear" title="Clear the agent conversation (document untouched)">Clear</button>',
            '  </div>',
            '  <div id="la_inputrow">',
            '    <textarea id="la_input" placeholder="e.g. draft a Plot Essential for a mage academy \u2014 or: change the magic system to blood-cost casting"></textarea>',
            '    <button class="la_btn la_primary" id="la_send">Send</button>',
            '  </div>',
            '</div>',
        ].join('\n');
        document.body.appendChild(panel);

        buildSettingsUI();
        makeDraggable(panel, el('la_header'));

        el('la_close').addEventListener('click', () => togglePanel(false));
        el('la_gear').addEventListener('click', () => {
            el('la_settings').classList.toggle('la_open');
            refreshProfileSelect();
            refreshPresetTools();
        });
        el('la_send').addEventListener('click', () => {
            if (running) { requestStop(); return; }
            const t = el('la_input').value;
            el('la_input').value = '';
            send(t);
        });
        el('la_input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!running) el('la_send').click();
            }
        });
        el('la_doc').addEventListener('change', () => {
            setActiveDoc(el('la_doc').value);
            renderAll();
        });
        el('la_preset').addEventListener('change', () => {
            const doc = activeDoc();
            if (!doc) return;
            doc.presetId = el('la_preset').value;
            persist();
            refreshPresetTools();
            toast('Preset for "' + doc.name + '" \u2192 ' + (presetForDoc(doc)?.name || '?') + ' (used from the next message).', 'info');
        });
        el('la_new').addEventListener('click', () => newDoc());
        el('la_dren').addEventListener('click', () => renameDoc());
        el('la_dup').addEventListener('click', () => dupDoc());
        el('la_ddel').addEventListener('click', () => deleteDoc());
        el('la_imp').addEventListener('click', () => importDoc());
        el('la_exp').addEventListener('click', () => exportDoc());
        el('la_dcopy').addEventListener('click', () => copyDoc());
        el('la_view').addEventListener('click', () => viewDoc());
        el('la_retry').addEventListener('click', () => retryLast());
        el('la_dellast').addEventListener('click', () => deleteLastExchange());
        el('la_undo').addEventListener('click', () => undoLast());
        el('la_clear').addEventListener('click', () => clearConversation());
    }

    function buildSettingsUI() {
        const box = el('la_settings');
        box.innerHTML = [
            '<label>LLM route (Connection Profile)</label>',
            '<select id="la_profile"></select>',
            '<div class="la_row">',
            '  <div><label>Max tokens</label><input type="number" id="la_maxtok" min="256" max="32768" step="256"></div>',
            '  <div><label>History depth (msgs sent)</label><input type="number" id="la_depth" min="2" max="80"></div>',
            '</div>',
            '<div class="la_check"><input type="checkbox" id="la_stream"><span>Streaming (needs a Connection Profile)</span></div>',
            '<div class="la_check"><input type="checkbox" id="la_showthink"><span>Show thinking blocks</span></div>',
            '<div class="la_presethead"><label>Agent instructions \u2014 preset: <b id="la_preset_name"></b></label></div>',
            '<textarea id="la_preset_prompt" placeholder="This document\'s preset prompt. Paste your full instructions here or via Edit in window (no length limit). The docedits protocol is appended automatically \u2014 never paste it into presets."></textarea>',
            '<div class="la_presetbtns">',
            '  <button class="la_btn" id="la_preset_edit" title="Edit this preset in a big window (best for 20k+ char prompts)">Edit in window</button>',
            '  <button class="la_btn" id="la_preset_reset" title="Restore the built-in placeholder (seeded presets only)">Reset default</button>',
            '  <button class="la_btn" id="la_preset_new" title="Create a new preset and assign it to this document">New</button>',
            '  <button class="la_btn" id="la_preset_ren" title="Rename this preset">Ren</button>',
            '  <button class="la_btn" id="la_preset_del" title="Delete this preset (built-ins cannot be deleted)">Del</button>',
            '</div>',
            '<div class="la_hint">Settings save automatically. v' + VERSION + '</div>',
        ].join('\n');

        el('la_maxtok').value = settings.maxTokens;
        el('la_depth').value = settings.historyDepth;
        el('la_stream').checked = !!settings.streaming;
        el('la_showthink').checked = !!settings.showThinking;
        refreshProfileSelect();
        refreshPresetTools();

        el('la_profile').addEventListener('change', () => { settings.profileId = el('la_profile').value; persist(); });
        el('la_maxtok').addEventListener('change', () => { settings.maxTokens = Math.max(256, Number(el('la_maxtok').value) || 4096); el('la_maxtok').value = settings.maxTokens; persist(); });
        el('la_depth').addEventListener('change', () => { settings.historyDepth = Math.max(2, Math.min(80, Number(el('la_depth').value) || 16)); el('la_depth').value = settings.historyDepth; persist(); });
        el('la_stream').addEventListener('change', () => { settings.streaming = el('la_stream').checked; persist(); });
        el('la_showthink').addEventListener('change', () => { settings.showThinking = el('la_showthink').checked; renderHistory(); persist(); });
        el('la_preset_prompt').addEventListener('input', () => {
            const p = presetForDoc(activeDoc());
            if (!p) return;
            p.prompt = el('la_preset_prompt').value;
            persist();
        });
        el('la_preset_edit').addEventListener('click', () => editPreset());
        el('la_preset_reset').addEventListener('click', () => resetPreset());
        el('la_preset_new').addEventListener('click', () => newPreset());
        el('la_preset_ren').addEventListener('click', () => renamePreset());
        el('la_preset_del').addEventListener('click', () => deletePreset());
    }

    function refreshProfileSelect() {
        const sel = el('la_profile');
        if (!sel) return;
        const profiles = getProfiles();
        sel.innerHTML = '';
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = 'Current API (raw generation, no streaming)';
        sel.appendChild(opt0);
        for (const p of profiles) {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = p.name || p.id;
            sel.appendChild(o);
        }
        sel.value = settings.profileId || '';
    }

    function refreshPresetTools() {
        const nameEl = el('la_preset_name');
        const ta = el('la_preset_prompt');
        if (!nameEl || !ta) return;
        const p = presetForDoc(activeDoc());
        nameEl.textContent = p ? p.name : '(none)';
        if (document.activeElement !== ta) ta.value = p ? p.prompt : '';
        ta.disabled = !p;
        const resetBtn = el('la_preset_reset');
        if (resetBtn) resetBtn.style.display = (p && isSeedPreset(p.id)) ? '' : 'none';
        const delBtn = el('la_preset_del');
        if (delBtn) delBtn.disabled = !p || isSeedPreset(p.id);
    }

    function refreshDocBar() {
        const dsel = el('la_doc');
        const psel = el('la_preset');
        if (!dsel || !psel) return;
        dsel.innerHTML = '';
        if (!settings.docs.length) {
            const o = document.createElement('option');
            o.value = '';
            o.textContent = '(no documents \u2014 press + New)';
            dsel.appendChild(o);
            dsel.value = '';
        } else {
            for (const d of settings.docs) {
                const o = document.createElement('option');
                o.value = d.id;
                o.textContent = oneLine(d.name).slice(0, 40) || 'Untitled';
                dsel.appendChild(o);
            }
            dsel.value = settings.activeDocId;
        }
        psel.innerHTML = '';
        for (const p of settings.presets) {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = '\uD83E\uDDE0 ' + (oneLine(p.name).slice(0, 30) || 'Unnamed');
            psel.appendChild(o);
        }
        const doc = activeDoc();
        psel.disabled = !doc;
        if (doc) psel.value = presetForDoc(doc)?.id || '';
    }

    function updateSub() {
        const sub = el('la_sub');
        if (!sub) return;
        const doc = activeDoc();
        sub.textContent = 'v' + VERSION + (doc
            ? ' \u00B7 ' + oneLine(doc.name).slice(0, 24) + ' \u00B7 ' + (doc.text || '').length.toLocaleString() + ' chars'
            : ' \u00B7 no document');
    }

    function setBusy(b) {
        const btn = el('la_send');
        if (btn) {
            btn.textContent = b ? 'Stop' : 'Send';
            btn.style.background = b ? 'rgba(220,90,90,0.85)' : '';
        }
        for (const id of ['la_retry', 'la_dellast', 'la_clear', 'la_new', 'la_dren', 'la_dup', 'la_ddel', 'la_imp']) {
            const x = el(id);
            if (x) x.disabled = b;
        }
        const dsel = el('la_doc');
        if (dsel) dsel.disabled = b;
    }

    // ------------------------------------------------------------------
    // Chat rendering
    // ------------------------------------------------------------------

    function attachMsgIcons(div, kind, hidx) {
        if (!Number.isInteger(hidx)) return;
        const mk = (txt, title, fn, op) => {
            const sp = document.createElement('span');
            sp.textContent = txt;
            sp.title = title;
            sp.style.cssText = 'margin-left:8px;cursor:pointer;opacity:' + (op || '0.55') + ';font-size:0.9em;';
            sp.addEventListener('click', fn);
            div.appendChild(sp);
        };
        if (kind === 'user') {
            mk('\u270E', 'Edit this message and continue from here', () => startEditUserMessage(hidx), '0.6');
        }
        mk('\uD83D\uDCCB', 'Copy message text', async () => {
            const doc = activeDoc();
            const h = doc?.history?.[hidx];
            const ok = await copyText(String(h?.content ?? ''));
            toast(ok ? 'Copied.' : 'Copy failed.', ok ? 'success' : 'error');
        });
        mk('\u2715', 'Delete this message', () => deleteMessageAt(hidx), '0.5');
    }

    function addBubble(kind, text, hidx) {
        const log = el('la_log');
        if (!log) return document.createElement('div');
        const div = document.createElement('div');
        const cls = kind === 'user' ? 'la_user' : (kind === 'assistant' || kind === 'ai') ? 'la_ai' : kind === 'busy' ? 'la_busy' : 'la_note';
        div.className = 'la_bubble ' + cls;
        div.innerHTML = esc(text);
        attachMsgIcons(div, kind, hidx);
        const pinned = kind === 'user' || (log.scrollHeight - log.scrollTop - log.clientHeight) < 60;
        log.appendChild(div);
        if (pinned) log.scrollTop = log.scrollHeight;
        return div;
    }

    function addAiBubble(rest, think, hidx) {
        const log = el('la_log');
        if (!log) return document.createElement('div');
        const div = document.createElement('div');
        div.className = 'la_bubble la_ai';
        let html = '';
        if (settings.showThinking && think) {
            html += '<details class="la_think"><summary>thinking</summary><div>' + esc(think) + '</div></details>';
        }
        html += esc(stripBlocks(rest) || '(no text)');
        div.innerHTML = html;
        attachMsgIcons(div, 'ai', hidx);
        log.appendChild(div);
        return div;
    }

    function renderHistory(forceScroll) {
        const log = el('la_log');
        if (!log) return;
        log.innerHTML = '';
        const doc = activeDoc();
        if (!doc) {
            addBubble('note', 'No document. Press + New to create one, or Imp to paste an existing file. Documents live outside any chat \u2014 nothing needs to be loaded.');
            updateSub();
            return;
        }
        const hist = doc.history;
        if (!hist.length) {
            addBubble('note', 'Talk to the agent about "' + doc.name + '". It edits the document through docedits cards you approve. Try: "draft the document" or "change X to Y".');
        }
        let lastDiv = null;
        let lastIdx = -1;
        for (let i = 0; i < hist.length; i++) {
            const h = hist[i];
            if (h.role === 'assistant') {
                lastDiv = addAiBubble(h.content, h.think, i);
                lastIdx = i;
            }
            else if (h.role === 'user') addBubble('user', h.content, i);
            else addBubble('note', h.content, i);
        }
        if (lastDiv && lastIdx === hist.length - 1) {
            const entry = hist[lastIdx];
            const total = Array.isArray(entry.swipes) && entry.swipes.length ? entry.swipes.length : 1;
            const cur = (Number.isInteger(entry.swipeId) ? entry.swipeId : total - 1) + 1;
            const bar = document.createElement('div');
            bar.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;opacity:0.75;user-select:none;';
            const mkArrow = (txt, dir, title) => {
                const b = document.createElement('span');
                b.textContent = txt;
                b.title = title;
                b.style.cssText = 'cursor:pointer;padding:0 10px;font-size:1.25em;';
                b.addEventListener('click', () => swipeAssistant(lastIdx, dir));
                return b;
            };
            bar.appendChild(mkArrow('\u2039', -1, 'Previous answer'));
            const cnt = document.createElement('span');
            cnt.textContent = cur + ' / ' + total;
            cnt.style.cssText = 'font-size:0.85em;';
            bar.appendChild(cnt);
            bar.appendChild(mkArrow('\u203A', 1, 'Next answer / generate a new alternative'));
            lastDiv.appendChild(bar);
        }
        log.scrollTop = log.scrollHeight;
        updateSub();
        if (forceScroll) log.scrollTop = log.scrollHeight;
    }

    // ------------------------------------------------------------------
    // Edit cards (red = find/anchor, green = replacement)
    // ------------------------------------------------------------------

    function editTypeLabel(edit) {
        if (edit.type === 'replace_all') return '\uD83E\uDDE8 Replace ALL';
        if (edit.type === 'append') return '\u2795 Append';
        if (edit.type === 'insert') return '\u2935 Insert after';
        return '\u270F Replace';
    }

    function renderEditCards() {
        const box = el('la_edits');
        if (!box) return;
        if (!pendingEdits.length) {
            box.classList.remove('la_open');
            box.innerHTML = '';
            return;
        }
        box.classList.add('la_open');
        const frag = document.createDocumentFragment();

        const pendingCount = pendingEdits.filter(e => e.status === 'pending').length;
        const head = document.createElement('div');
        head.className = 'la_edits_head';
        head.innerHTML = '<span>Proposed edits: ' + pendingEdits.length + (pendingCount !== pendingEdits.length ? ' (' + pendingCount + ' pending)' : '') + '</span>' +
            '<button class="la_btn" id="la_toggleedits">' + (editsCollapsed ? 'Show' : 'Hide') + '</button>' +
            '<button class="la_btn la_primary" id="la_applyall">Apply all pending</button>' +
            '<button class="la_btn" id="la_dismissall">Dismiss</button>';
        frag.appendChild(head);

        const list = document.createElement('div');
        if (editsCollapsed) list.style.display = 'none';

        pendingEdits.forEach((edit, idx) => {
            const card = document.createElement('div');
            card.className = 'la_card';
            const findShown = edit.type === 'append'
                ? '(end of document)'
                : edit.type === 'replace_all'
                    ? '(entire document \u2014 full rewrite)'
                    : edit.find;
            card.innerHTML =
                '<div class="la_card_top"><b>' + editTypeLabel(edit) + '</b><span>' + esc(edit.reason || '') + '</span>' +
                (edit.status === 'pending'
                    ? '<button class="la_btn" data-la-apply="' + idx + '">Apply</button><button class="la_btn" data-la-skip="' + idx + '">Skip</button>'
                    : '') +
                '</div>' +
                '<div class="la_diff la_before">' + esc(findShown) + '</div>' +
                '<div class="la_diff la_after">' + esc(edit.replace) + '</div>' +
                (edit.status !== 'pending' ? '<div class="la_card_status">' + esc(edit.status) + '</div>' : '');
            list.appendChild(card);
        });

        frag.appendChild(list);
        box.innerHTML = '';
        box.appendChild(frag);

        el('la_applyall')?.addEventListener('click', () => applyEdits(pendingEdits));
        el('la_dismissall')?.addEventListener('click', () => {
            pendingEdits = [];
            renderEditCards();
        });
        el('la_toggleedits')?.addEventListener('click', () => {
            editsCollapsed = !editsCollapsed;
            renderEditCards();
        });
        box.querySelectorAll('[data-la-apply]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = Number(btn.getAttribute('data-la-apply'));
                applyEdits([pendingEdits[i]]);
            });
        });
        box.querySelectorAll('[data-la-skip]').forEach(btn => {
            btn.addEventListener('click', () => {
                const i = Number(btn.getAttribute('data-la-skip'));
                pendingEdits[i].status = 'skipped';
                renderEditCards();
            });
        });
    }

    function renderAll() {
        refreshDocBar();
        refreshPresetTools();
        renderHistory();
        renderEditCards();
        updateSub();
    }

    function togglePanel(force) {
        const panel = el('la_panel');
        if (!panel) return;
        const open = typeof force === 'boolean' ? force : !panel.classList.contains('la_open');
        panel.classList.toggle('la_open', open);
        if (open) {
            // Reset stray inline position from a previous drag so the panel can
            // never open stranded off-screen after a rotate/resize.
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '';
            panel.style.bottom = '';
            renderAll();
        }
    }

    // ------------------------------------------------------------------
    // Wand menu + slash command + init
    // ------------------------------------------------------------------

    function addMenuButton() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('la_menu_item')) return;
        const div = document.createElement('div');
        div.id = 'la_menu_item';
        div.className = 'list-group-item flex-container flexGap5 interactable';
        div.title = 'Toggle Lore Agent';
        div.innerHTML = '<i class="fa-solid fa-scroll"></i><span>Lore Agent</span>';
        div.addEventListener('click', () => togglePanel());
        menu.appendChild(div);
    }

    function registerSlash() {
        const c = ctx();
        const handler = async (_named, text) => {
            togglePanel(true);
            const t = typeof text === 'string' ? text.trim() : '';
            if (t) await send(t);
            return '';
        };
        try {
            if (typeof c.registerSlashCommand === 'function') {
                c.registerSlashCommand('lore', handler, [], '<span>\u2014 toggle Lore Agent / send it a request</span>', true, true);
                return;
            }
        } catch (e) { /* ignore */ }
        try {
            if (c.SlashCommandParser?.addCommandObject && c.SlashCommand?.fromProps) {
                c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
                    name: 'lore',
                    callback: handler,
                    helpString: 'Toggle Lore Agent, or send it a request: /lore change the magic system to blood-cost casting',
                }));
            }
        } catch (e) { console.warn(LOG, 'slash registration failed', e); }
    }

    function init() {
        if (inited) return;
        // Load-test / non-browser guard: `node -e "...require('./index.js')"`
        // must never crash (the 3s fallback timer still fires under node).
        if (typeof document === 'undefined' || !document.body) return;
        let c = null;
        try { c = ctx(); } catch (e) { /* ignore */ }
        if (!c || !c.extensionSettings || !document.getElementById('extensionsMenu')) {
            if (initTries < 20) {
                initTries++;
                setTimeout(init, 1000);
                return;
            }
        }
        if (!c || !c.extensionSettings) {
            console.error(LOG, 'giving up: SillyTavern context unavailable');
            return;
        }
        inited = true;
        try {
            loadSettings();
            buildPanel();
            addMenuButton();
            registerSlash();
            console.log(LOG, 'ready v' + VERSION, '\u00B7', settings.docs.length + ' doc(s),', settings.presets.length + ' preset(s)');
        } catch (e) {
            console.error(LOG, 'init failed', e);
        }
    }

    try {
        const c = SillyTavern.getContext();
        if (c?.eventSource && c?.event_types?.APP_READY) {
            c.eventSource.on(c.event_types.APP_READY, init);
        }
    } catch (e) { /* ignore */ }

    // Fallback in case APP_READY already fired or is unavailable.
    setTimeout(init, 3000);

    // Engine internals exposed for automated testing (harmless in production).
    try {
        globalThis.__loreAgentDebug = {
            VERSION, findBlock, parseDocEdits, stripBlocks, splitThinking,
            normChars, levenshtein, locate, applyEditToText, grow,
        };
    } catch (e) { /* ignore */ }
})();
