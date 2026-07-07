/*
 * Plot Essential and Instructions Maker — a SillyTavern extension for AI-edited documents.
 * (Internal module id is 'loreAgent' — the extensionSettings storage key, the LOG prefix,
 *  and the __loreAgentDebug export. NEVER rename it: all saved docs/presets live under it.)
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

    // Internal module id: the extensionSettings storage key, the console LOG prefix,
    // and the globalThis.__loreAgentDebug global all use this. The user-facing name is
    // "Plot Essential and Instructions Maker" (manifest.display_name). Do NOT change this
    // internal id — it is the key every saved document and preset lives under; renaming
    // it orphans all real user data. The rename only touched display strings.
    const MODULE = 'loreAgent';
    const LOG = '[LoreAgent]';
    const VERSION = '0.11.15';

    // ------------------------------------------------------------------
    // Seeded presets (placeholders — paste your real instructions via the
    // preset Edit button; they can be 20k+ chars, no length caps anywhere)
    // ------------------------------------------------------------------

    const PRESET_PE_ID = 'seed_pe_maker';
    const PRESET_AI_ID = 'seed_ai_instructions';
    const PRESET_WB_ID = 'seed_worldbook_maker';

    // Full working default (not a placeholder): builds a usable SillyTavern
    // worldbook on day one. Attach the Plot Essential as a reference (the link
    // button) so entries stay consistent with the spine.
    const WORLDBOOK_MAKER_PROMPT = [
        'You are a worldbook architect for SillyTavern. You build and maintain a WORLDBOOK: the large body of world lore that lives OUTSIDE the Plot Essential (PE) - the encyclopedia to the PE spine. NPCs, locations, factions, history, items, cultures, magic/tech systems.',
        '',
        'You edit the worldbook document through the docedits protocol (find/replace, insert_after, append). The document is ONE JSON array of entry objects. Full entry shape (only name/keys/content/strategy are required; set the rest when you have a reason, otherwise omit and safe defaults apply):',
        '  {',
        '    "name": "Short unique title",',
        '    "keys": ["keyword","alias","proper noun"],',
        '    "content": "The lore text the model reads when this entry fires.",',
        '    "strategy": "green",',
        '    "order": 100,',
        '    "position": "after_char",',
        '    "depth": 4,',
        '    "probability": 100,',
        '    "comment": "optional author note"',
        '  }',
        '',
        'YOU OWN EVERY FIELD. The user does not hand-tune worldbooks - they trust you to choose the correct setting for each entry from what the entry IS. Never leave a field to a blind default when the entry has a clear need. Reason per entry:',
        '',
        'STRATEGY - how the entry activates:',
        '- "blue" = ALWAYS in context. Only for a few world-spine facts that must never be absent (the setting premise, an active war, the core ruleset). Blue costs permanent tokens, so keep it to a handful. Blue entries may have empty keys.',
        '- "green" = fires when a key appears in recent chat. THE DEFAULT for nearly everything - characters, places, factions, items. Give each a generous, deliberate key list: proper name, aliases, epithets, titles, and the everyday words a scene would use (a general named Aldric of the Iron Legion keys on "Aldric", "Iron Legion", "the general", plus any nickname).',
        '- "chain" = semantic/vector only. Do NOT use alone (invisible when the user has no vectors). Author green with real keys instead; the exporter also makes green entries vector-eligible so they fire on keywords AND semantically when vectors are on. Use bare "chain" only if the user says they always run vectors.',
        '',
        'ORDER - insertion priority when several entries fire together (higher = inserted earlier / wins token budget first). Choose by importance:',
        '- spine/blue: high (250-350).',
        '- major recurring characters, central factions: 180-220.',
        '- ordinary dossiers (a specific NPC, place, item): ~100-150.',
        '- minor flavour/background: 50-90.',
        'When several entries belong to one set (e.g. King Britannia\'s 5 generals), give them the SAME order so they rank together, unless one is clearly more important.',
        '',
        'POSITION - where the entry text is inserted. Use the string values:',
        '- "before_char" = before the character definitions ({{wiBefore}}). Good for world/setting/background lore that should frame everything: history, geography, factions, lore the model should read before the character.',
        '- "after_char" = after the character definitions ({{wiAfter}}). THE DEFAULT for most entries - character dossiers, relationships, situational lore that should sit close to the acting character.',
        '- "at_depth" = injected at a specific chat depth (needs "depth", default 4). Use for lore that must stay near the most recent messages / act like a nudge, e.g. an active status, a currently-relevant secret, a behavioral reminder. Higher depth = further from the latest message.',
        'Rule of thumb: static world-building -> before_char; who/what is on stage -> after_char; live, must-be-noticed-now -> at_depth.',
        '',
        'PROBABILITY - percent chance the entry fires when triggered (default 100). Keep 100 for facts. Lower it only for deliberately intermittent flavour (a rumor that sometimes surfaces, a random event), typically 25-75.',
        '',
        'RULES:',
        '1. ONE TOPIC PER ENTRY. One general, one city, one artifact - never bundle. So "King Britannia has 5 generals" = 1 short entry for the king (or the command structure) PLUS 1 entry per general, each with its own name, keys, order, position - not one lumped entry, and not five identical blind ones. Differentiate them (each general\'s keys, domain, allegiance).',
        '2. Default green + strong keys. Blue only for true spine (rare). Chain never alone.',
        '3. If a [REFERENCE DOCUMENT] with the PE is present, it is canon: match names, facts, tone, timeline; do not duplicate spine the PE already holds; the worldbook is lore BEYOND the PE. If a background entry becomes spine-critical, say so and suggest moving it into the PE.',
        '4. "content" is what the AI reads at runtime: clean self-contained lore prose, no meta commentary inside it. Split long topics into linked entries.',
        '5. "name" unique in the document.',
        '6. Keep the document a single valid JSON array at all times: append new entries inside the array, edit one with a surgical find/replace on its text, never break JSON validity.',
        '7. Empty document -> initialize with an append edit whose replace value is a JSON array (start [] or with the first entries).',
        '8. Briefly note in prose WHY you chose non-obvious settings (e.g. "put the active siege at_depth so it stays salient; gave all five generals order 200 so they rank together").',
    ].join('\n')

    const DEFAULT_PRESET_PROMPTS = {
        [PRESET_PE_ID]: 'You are a world-lore architect who edits the document with surgical docedits. (Placeholder — open this preset\'s Edit button and paste the full Plot Essential Maker instructions.)',
        [PRESET_AI_ID]: 'You are an expert author of AI instruction sets who edits the document with surgical docedits. (Placeholder — open this preset\'s Edit button and paste the full instructions.)',
        [PRESET_WB_ID]: WORLDBOOK_MAKER_PROMPT,
    };

    function defaultPresets() {
        return [
            { id: PRESET_PE_ID, name: 'Plot Essential Maker', prompt: DEFAULT_PRESET_PROMPTS[PRESET_PE_ID] },
            { id: PRESET_AI_ID, name: 'AI Instructions Maker', prompt: DEFAULT_PRESET_PROMPTS[PRESET_AI_ID] },
            { id: PRESET_WB_ID, name: 'Worldbook Maker', prompt: DEFAULT_PRESET_PROMPTS[PRESET_WB_ID] },
        ];
    }

    // ------------------------------------------------------------------
    // The docedits protocol — appended to EVERY preset programmatically,
    // never stored inside presets, so protocol upgrades ship with the
    // extension and users never have to touch their prompts.
    // ------------------------------------------------------------------

    const DOCEDITS_PROTOCOL = [
        '=== DOCEDITS PROTOCOL (attached automatically by the Plot Essential and Instructions Maker extension — follow it exactly, never restate it) ===',
        'You are working on the text file shown in [DOCUMENT]. You change it ONLY by ending a reply with exactly one block in this exact format:',
        '',
        '<docedits>',
        '[',
        '  {"find": "verbatim excerpt copied character-for-character from the document", "replace": "new text", "reason": "short why"},',
        '  {"insert_after": "verbatim anchor line copied from the document", "replace": "new paragraph placed on a new line under the anchor line", "reason": "short why"},',
        '  {"append": true, "replace": "text added at the end of the document", "reason": "short why"},',
        '  {"doc": "Name Of A Reference Document", "find": "verbatim excerpt from that reference document", "replace": "new text", "reason": "the doc field targets a reference document"},',
        '  {"replace_all": true, "replace": "entire new document text", "reason": "only when the user explicitly asked for a full rewrite"}',
        ']',
        '</docedits>',
        '',
        'Rules:',
        '1. "find" and "insert_after" must be copied CHARACTER-FOR-CHARACTER from the current [DOCUMENT]: same wording, punctuation, capitalization, spacing and line breaks (write line breaks as \\n). Never paraphrase, trim, or fix typos inside them.',
        '2. Keep "find" as short as possible while staying unique in the document (one line up to a few lines). If the excerpt appears more than once, extend it until it is unique.',
        '3. Prefer several small surgical edits over one big rewrite. Use "append" for new sections at the end of the document. Use "insert_after" to add content below an existing line: its "replace" text is placed starting on a new line directly under the anchor line — put a leading \\n inside "replace" if you want a blank line between them. Use "replace_all" ONLY when the user explicitly requests a full rewrite of the whole document.',
        '4. The block must be valid JSON: property strings in double quotes; write EVERY line break inside a value as \\n (never a real line break); if a value must contain a quotation mark use single quotes or escape it as \\", never a raw double quote inside the value; no comments, no trailing commas, no markdown fences.',
        '5. At most ONE docedits block per reply, placed at the very END of the reply, after a brief prose explanation of what you changed and why. If nothing needs changing, output no block at all.',
        '6. In prose, refer to the mechanism as the "docedits block" in plain words. The literal angle-bracket tag must appear ONLY around the actual JSON block, never inside explanations.',
        '7. If the document is empty, draft it with "append" edits (one per section works well).',
        '8. The user may want to discuss before applying. If they reply to talk it over rather than accept, answer in prose with NO block. Proposals you already made but the user has not applied are shown back to you as [PENDING PROPOSALS] with numbers (Edit 1, Edit 2, \u2026). If your new reply is a better version of one of those (the same change, improved) rather than a separate new change, put a supersede tag naming the stale one(s) just before your docedits block \u2014 e.g. <supersede>1</supersede> or <supersede>1,2</supersede> \u2014 so the stale proposal is auto-skipped and the user never applies both. If you are adding a genuinely new, independent change, do not supersede. Never resend a proposal that has not changed.',
        '9. Read-only context may appear as [REFERENCE DOCUMENT: name] blocks. By default every edit applies to the main [DOCUMENT]. To edit a reference document instead, add "doc": "its exact name" to that edit object \u2014 and whenever any reference documents are present, include "doc" on EVERY edit so the target is never ambiguous. Copy "find"/"insert_after" character-for-character from the document you are targeting.',
        '10. Make the specific change the user asked for and stop there. Do NOT bundle in unrequested cosmetic edits \u2014 collapsing double spaces, tidying indentation or whitespace, deleting stray-quote artifacts \u2014 unless the user explicitly asks for a cleanup pass. They waste the user\u2019s time, frequently fail to match on whitespace, and bury the change actually wanted.',
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
        barOpen: false,   // management fold-out under the doc/session row
        fullscreen: false,// panel fills the viewport
        batchLog: [],  // ids of applied batches, newest last (cross-doc undo)
        compareIds: [],           // docs selected in the compare view (max 4)
        compareLayout: 'columns', // 'columns' | 'stacked'
        docs: [],      // [{id, name, text, updated, presetId, history, undo, refs}]
        presets: [],   // [{id, name, prompt}]
    };

    // Valid default object from load so pre-init access (and the node test
    // harness, where init never runs) never hits a null; loadSettings()
    // reassigns this to the ctx-backed, persisted object in production.
    let settings = Object.assign({}, defaults, { docs: [], presets: defaultPresets() });
    let pendingEdits = [];   // [{type, find, replace, reason, docName, status, batch}]
    let editBatchSeq = 0;    // increments per accepted proposal block this session-view
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

    // Coerce a possibly-string numeric field to a finite number, else default.
    // Models frequently emit numeric worldbook fields as JSON strings
    // ("order":"250"); Number.isFinite("250") is false, so the raw guard used
    // to silently drop them back to defaults. This recovers them.
    function numOr(v, d) {
        if (typeof v === 'number') return Number.isFinite(v) ? v : d;
        if (typeof v === 'string') {
            const t = v.trim();
            if (!t) return d;
            const n = Number(t);
            return Number.isFinite(n) ? n : d;
        }
        return d;
    }

    function uid() {
        return 'la_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function toast(msg, type) {
        try {
            if (typeof window !== 'undefined' && window.toastr) {
                (window.toastr[type || 'info'] || window.toastr.info)(msg, 'Plot Essential & Instructions Maker');
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

    function mimeForName(n) {
        const m = String(n).toLowerCase().match(/\.([a-z0-9]{1,8})$/);
        const ext = m ? m[1] : 'md';
        const map = {
            md: 'text/markdown', markdown: 'text/markdown', json: 'application/json',
            yaml: 'application/x-yaml', yml: 'application/x-yaml', xml: 'application/xml',
            csv: 'text/csv', html: 'text/html', txt: 'text/plain',
        };
        return (map[ext] || 'text/plain') + ';charset=utf-8';
    }

    function downloadText(name, text) {
        try {
            const base = safeFileName(name);
            const fname = /\.[a-z0-9]{1,8}$/i.test(base) ? base : base + '.md';
            const blob = new Blob([String(text ?? '')], { type: mimeForName(fname) });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = fname;
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
        if (!Array.isArray(d.sessions) || !d.sessions.length) {
            const old = Array.isArray(d.history) ? d.history : [];
            d.sessions = [{ id: 1, name: 'Session 1', history: old }];
            d.activeSessionId = 1;
        }
        delete d.history; // migrated into sessions
        for (const sx of d.sessions) {
            if (!Array.isArray(sx.history)) sx.history = [];
            sx.name = String(sx.name || ('Session ' + sx.id));
        }
        if (!d.sessions.some(sx => sx.id === d.activeSessionId)) d.activeSessionId = d.sessions[0].id;
        if (!Array.isArray(d.undo)) d.undo = [];
        if (!Array.isArray(d.refs)) d.refs = [];
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
            undo: [],
            refs: [],
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

    // Resolve an agent-provided "doc" name against a set of documents:
    // exact -> case-insensitive -> unique partial. Ambiguity returns null.
    function resolveDocByName(docs, name) {
        const n = String(name || '').trim();
        if (!n) return null;
        let hit = docs.find(d => d.name === n);
        if (hit) return hit;
        const low = n.toLowerCase();
        const ci = docs.filter(d => String(d.name).trim().toLowerCase() === low);
        if (ci.length === 1) return ci[0];
        const part = docs.filter(d => String(d.name).toLowerCase().includes(low));
        if (part.length === 1) return part[0];
        return null;
    }

    function refsOf(doc) {
        if (!doc || !Array.isArray(doc.refs)) return [];
        return doc.refs
            .map(id => settings.docs.find(d => d.id === id))
            .filter(d => d && d.id !== doc.id);
    }

    function sess(doc) {
        if (!doc) return null;
        if (!Array.isArray(doc.sessions) || !doc.sessions.length) ensureDocShape(doc);
        return doc.sessions.find(sx => sx.id === doc.activeSessionId) || doc.sessions[0];
    }

    function nextSessId(doc) {
        return doc.sessions.reduce((m, sx) => Math.max(m, Number(sx.id) || 0), 0) + 1;
    }

    function pushHistory(doc, role, content, think) {
        if (!doc) return;
        const entry = { role, content: String(content ?? '') };
        if (think) entry.think = String(think).slice(0, 20000);
        if (role === 'assistant') {
            entry.swipes = [{ content: entry.content, think: entry.think || '' }];
            entry.swipeId = 0;
        }
        const m = sess(doc);
        m.history.push(entry);
        if (m.history.length > 80) m.history.splice(0, m.history.length - 80);
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

    function pushUndo(doc, beforeText, label, batch) {
        if (!doc) return;
        if (!Array.isArray(doc.undo)) doc.undo = [];
        doc.undo.push({ ts: Date.now(), text: String(beforeText ?? ''), label: String(label || 'edit'), batch: batch || null });
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

    // Models very often emit multi-line "find"/"replace" values with RAW line
    // breaks (and tabs) instead of \n, which is invalid JSON. Escape control
    // characters that occur *inside* string literals so the block still parses.
    // Only chars between unescaped double-quotes are touched; structural
    // whitespace outside strings is untouched. (Unescaped inner double-quotes are
    // NOT repairable this way — the model must use single quotes or escape them.)
    function escapeRawControlsInStrings(s) {
        let out = '', inStr = false, esc = false;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (esc) { out += c; esc = false; continue; }
            if (c === '\\') { out += c; esc = true; continue; }
            if (c === '"') { inStr = !inStr; out += c; continue; }
            if (inStr) {
                if (c === '\n') { out += '\\n'; continue; }
                if (c === '\r') { out += '\\r'; continue; }
                if (c === '\t') { out += '\\t'; continue; }
            }
            out += c;
        }
        return out;
    }

    // Deterministic document linter — reads the RAW text (no LLM guessing) and reports
    // inline double-spaces (shown with visible middle-dots), trailing whitespace, tabs,
    // and JSON validity. Settles "is that two spaces or one?" authoritatively, and
    // catches the JSON format errors an LLM misses.
    function docLint(text) {
        text = String(text ?? '');
        const out = { inlineDoubleSpaces: [], inlineCount: 0, trailingWs: 0, tabs: 0, crlf: text.indexOf('\r\n') !== -1, jsonLike: false, jsonValid: null, jsonError: '', jsonFixable: false };
        const lines = text.split('\n');
        lines.forEach((line, li) => {
            if (/[ \t]+$/.test(line)) out.trailingWs++;
            out.tabs += (line.match(/\t/g) || []).length;
            const fns = line.search(/\S/);
            if (fns >= 0) {
                const body = line.slice(fns);
                body.replace(/ {2,}/g, (run, offset) => {
                    const before = body[offset - 1], after = body[offset + run.length];
                    if (before && before !== ' ' && after && after !== ' ') {
                        out.inlineCount++;
                        if (out.inlineDoubleSpaces.length < 25) {
                            const a = Math.max(0, offset - 14), b = Math.min(body.length, offset + run.length + 14);
                            out.inlineDoubleSpaces.push({ line: li + 1, spaces: run.length, sample: body.slice(a, b).replace(/ /g, '\u00B7') });
                        }
                    }
                    return run;
                });
            }
        });
        const t = text.trim();
        if (t.charAt(0) === '{' || t.charAt(0) === '[') {
            out.jsonLike = true;
            try { JSON.parse(text); out.jsonValid = true; }
            catch (e) {
                out.jsonValid = false; out.jsonError = String((e && e.message) || e);
                try { JSON.parse(escapeRawControlsInStrings(text.replace(/,\s*([\]}])/g, '$1'))); out.jsonFixable = true; }
                catch (e2) { out.jsonFixable = false; }
            }
        }
        return out;
    }

    // Collapse runs of 2+ spaces that sit BETWEEN non-space chars (inline artifacts),
    // preserving leading indentation, blank lines, and trailing spaces.
    function collapseInlineSpaces(text) {
        return String(text ?? '').split('\n').map(line => {
            const fns = line.search(/\S/);
            if (fns < 0) return line;
            const indent = line.slice(0, fns);
            const body = line.slice(fns).replace(/ {2,}/g, (run, offset, str) => {
                const before = str[offset - 1], after = str[offset + run.length];
                return (before && before !== ' ' && after && after !== ' ') ? ' ' : run;
            });
            return indent + body;
        }).join('\n');
    }

    // Make an invalid JSON document parseable by escaping raw control chars inside
    // strings and dropping trailing commas. Returns unchanged text if already valid or
    // not repairable. Content is preserved (escaped \n parses back to a real newline).
    function repairDocJson(text) {
        text = String(text ?? '');
        try { JSON.parse(text); return { changed: false, text }; } catch (e) { /* repair below */ }
        const fixed = escapeRawControlsInStrings(text.replace(/,\s*([\]}])/g, '$1'));
        try { JSON.parse(fixed); return { changed: fixed !== text, text: fixed }; }
        catch (e) { return { changed: false, text, error: String((e && e.message) || e) }; }
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
            // Repair passes for the common LLM JSON slips, tried in order.
            let repaired = raw.replace(/,\s*([\]}])/g, '$1');   // 1) trailing commas
            try { arr = JSON.parse(repaired); }
            catch (e2) {
                // 2) literal newlines/tabs inside string values (the #1 slip:
                // models paste multi-line find/replace with raw breaks, not \n).
                repaired = escapeRawControlsInStrings(repaired);
                try { arr = JSON.parse(repaired); }
                catch (e3) { return { edits: [], error: 'could not parse docedits JSON: ' + e3.message }; }
            }
        }
        if (!Array.isArray(arr)) return { edits: [], error: 'docedits block is not a JSON array' };
        const edits = [];
        for (const e of arr) {
            if (!e || typeof e !== 'object') continue;
            const replace = String(e.replace ?? '');
            const reason = String(e.reason ?? '');
            const docName = (typeof e.doc === 'string' && e.doc.trim()) ? e.doc.trim() : null;
            if (e.replace_all === true) { edits.push({ type: 'replace_all', find: null, replace, reason, docName, status: 'pending' }); continue; }
            if (e.append === true) { edits.push({ type: 'append', find: null, replace, reason, docName, status: 'pending' }); continue; }
            if (typeof e.insert_after === 'string' && e.insert_after.length) { edits.push({ type: 'insert', find: e.insert_after, replace, reason, docName, status: 'pending' }); continue; }
            if (typeof e.find === 'string' && e.find.length) { edits.push({ type: 'replace', find: e.find, replace, reason, docName, status: 'pending' }); continue; }
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
        out = out.replace(/<supersede>[\s\S]*?<\/supersede>/gi, '');
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
            // A fuzzy match is SAFE to apply only when it differs from the quote by
            // WHITESPACE alone (after quote/dash normalization) — identical words in the
            // same order, just different spacing. Then applying the replacement cannot
            // change anything the model did not intend. Any word or punctuation
            // difference means the model misquoted the real text, so it is refused
            // (applyEditToText fails it and the agent re-quotes) rather than writing an
            // inexact version over the document. This keeps whitespace fixes working
            // while never applying an approximate ("83%") guess to an authored file.
            const nWS = (x) => x.replace(/\s+/g, ' ').trim();
            const safe = nWS(hay2.slice(st.index, en.index + en[0].length)) === nWS(needle2);
            return { start: st.index, end: en.index + en[0].length, fuzzy: true, safe, sim: best.sim, count: 1 };
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
        // Exact / quote-normalized matches always apply (precise character boundaries).
        // A FUZZY match applies only when it is edge-safe (loc.safe: first & last words
        // match the needle exactly), which guarantees the replaced span begins/ends on
        // those exact words — nothing duplicated, no adjacent line reflowed. This lets a
        // whitespace-only difference (same words, different spacing) apply, while an
        // edge-drifting paraphrase is refused and re-quoted.
        if (!loc || (loc.fuzzy && !loc.safe)) {
            const what = edit.type === 'insert' ? 'insert_after anchor' : '"find" text';
            return { ok: false, reason: (loc && loc.fuzzy)
                ? what + ' matched approximately (' + Math.round(loc.sim * 100) + '%) but not word-for-word — only a pure whitespace difference is auto-applied, so an approximate/misquoted match is refused rather than written over the real text. Copy it character-for-character from the current [DOCUMENT] and resend.'
                : what + ' not located — copy it character-for-character from the current [DOCUMENT] and resend.' };
        }
        let note = loc.fuzzy ? (loc.sim >= 0.995 ? ' (spacing normalized)' : ' (fuzzy ' + Math.round(loc.sim * 100) + '%)') : '';
        let next;
        if (edit.type === 'insert') {
            // Insert on a new line after the END of the line containing the anchor.
            let ip = text.indexOf('\n', loc.end);
            if (ip === -1) ip = text.length;
            next = text.slice(0, ip) + '\n' + rep + text.slice(ip);
        } else {
            next = text.slice(0, loc.start) + rep + text.slice(loc.end);
            if (loc.count > 1) note += ' (matched 1 of ' + loc.count + ' occurrences)';
        }
        if (next === text) return { ok: false, reason: 'no change produced' };
        return { ok: true, text: next, note };
    }

    function applyEdits(list) {
        const main = activeDoc();
        if (!main) { toast('No document selected.', 'warning'); return; }
        const todo = (list || []).filter(e => e && e.status === 'pending');
        if (!todo.length) { renderEditCards(); return; }

        // Edits may target the main document (default) or any attached
        // reference document via the "doc" field. Each target keeps its own
        // evolving working text so a batch applies sequentially per document.
        const allowed = [main, ...refsOf(main)];
        const work = new Map(); // docId -> {doc, before, text, count}
        const getWork = (d) => {
            let w = work.get(d.id);
            if (!w) { w = { doc: d, before: String(d.text || ''), text: String(d.text || ''), count: 0 }; work.set(d.id, w); }
            return w;
        };
        for (const edit of todo) {
            let target = main;
            if (edit.docName) {
                target = resolveDocByName(allowed, edit.docName);
                if (!target) {
                    edit.status = 'failed: document "' + edit.docName + '" is not this conversation\u2019s document or an attached reference (\uD83D\uDD17)';
                    continue;
                }
            }
            const w = getWork(target);
            const res = applyEditToText(w.text, edit);
            if (res.ok) {
                w.text = res.text;
                w.count++;
                edit.status = 'applied' + (res.note || '') + (target.id !== main.id ? ' \u2192 ' + target.name : '');
            } else {
                edit.status = 'failed: ' + res.reason + (target.id !== main.id ? ' (in "' + target.name + '")' : '');
            }
        }
        const changed = [...work.values()].filter(w => w.count > 0);
        const failed = todo.filter(e => String(e.status || '').startsWith('failed'));
        let appliedNote = '';
        if (changed.length) {
            const batchId = uid();
            for (const w of changed) {
                pushUndo(w.doc, w.before, w.count + ' edit(s)', batchId);
                w.doc.text = w.text;
                w.doc.updated = Date.now();
            }
            if (!Array.isArray(settings.batchLog)) settings.batchLog = [];
            settings.batchLog.push(batchId);
            while (settings.batchLog.length > 8) settings.batchLog.shift();
            appliedNote = 'Applied: ' + changed.map(w => w.count + ' edit(s) \u2192 "' + w.doc.name + '"').join(', ') + '.';
            pushHistory(main, 'note', appliedNote);
        }
        if (failed.length) {
            // Feed the miss back to the agent as a [STATE] note it sees next turn, so it
            // re-quotes the excerpt verbatim instead of the failure sitting silently on a
            // card. Matching stays STRICT (no threshold loosening) — a loose match on a long
            // authored document could replace the wrong passage and corrupt it, which is
            // worse than a clean, recoverable failure.
            pushHistory(main, 'note', '\u26A0 ' + failed.length + ' proposal(s) could not be applied: the quoted excerpt was not found in the document. Copy the "find"/anchor text CHARACTER-FOR-CHARACTER from the current [DOCUMENT] and resend \u2014 do not paraphrase; if unsure of the exact wording, quote a shorter fragment you are certain is verbatim. Unmatched: ' + failed.map(e => '\u201C' + oneLine(String(e.find || '(no find text)')).slice(0, 48) + '\u201D').join('; ') + '.');
        }
        if (changed.length || failed.length) {
            persist();
            renderHistory();
            updateSub();
        }
        if (changed.length) {
            for (const w of changed) syncOpenDocEditor(w.doc, w.before);
            toast(appliedNote + (failed.length ? '  \u2014  ' + failed.length + ' could not locate their excerpt.' : ''), failed.length ? 'warning' : 'success');
        } else if (failed.length) {
            toast(failed.length + ' proposal(s) could not locate their excerpt \u2014 the agent has been told to resend them verbatim.', 'warning');
        }
        renderEditCards();
    }

    function undoLast() {
        // 1) Batch undo: revert the most recent applied batch on EVERY
        // document it touched (main + references), newest batch first.
        if (!Array.isArray(settings.batchLog)) settings.batchLog = [];
        while (settings.batchLog.length) {
            const bid = settings.batchLog[settings.batchLog.length - 1];
            const hits = settings.docs.filter(d => Array.isArray(d.undo) && d.undo.length && d.undo[d.undo.length - 1].batch === bid);
            const buried = settings.docs.filter(d => Array.isArray(d.undo) && d.undo.some(u => u.batch === bid) && (!d.undo.length || d.undo[d.undo.length - 1].batch !== bid));
            settings.batchLog.pop();
            if (!hits.length) continue; // stale id (docs deleted / fully buried) \u2014 try an older batch
            const names = [];
            for (const d of hits) {
                const u = d.undo.pop();
                const before = String(d.text || '');
                d.text = String(u.text ?? '');
                d.updated = Date.now();
                names.push('"' + d.name + '"');
                syncOpenDocEditor(d, before);
            }
            persist();
            let note = 'Undid last applied batch on: ' + names.join(', ') + '.';
            if (buried.length) note += ' Skipped ' + buried.map(d => '"' + d.name + '"').join(', ') + ' (changed since \u2014 switch to it and press Undo there).';
            const active = activeDoc();
            if (active) pushHistory(active, 'note', note);
            renderHistory();
            updateSub();
            toast(note, 'success');
            return;
        }
        // 2) Fallback: plain per-document undo on the active document
        // (manual View\u2192Save edits, or batches older than the batch log).
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const u = Array.isArray(doc.undo) ? doc.undo.pop() : null;
        if (!u) { toast('Nothing to undo for this document.', 'warning'); return; }
        const before = String(doc.text || '');
        doc.text = String(u.text ?? '');
        doc.updated = Date.now();
        persist();
        const note = 'Undid (' + (u.label || 'edit') + ') on "' + doc.name + '".';
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

    function refBlock(doc) {
        const body = String(doc.text || '');
        return '[REFERENCE DOCUMENT: ' + (doc.name || 'Untitled') + ']\n'
            + (body.length ? body : '(this reference document is currently empty)')
            + '\n[/REFERENCE DOCUMENT]';
    }

    function contextBlocks(doc) {
        const parts = refsOf(doc).map(refBlock);
        parts.push(docBlock(doc));
        return parts.join('\n\n');
    }

    // Keep the last `depth` REAL turns (user/assistant); [STATE] notes ride
    // along with whichever turns they sit between instead of counting against
    // the budget, so a run of "Applied: ..." notes can't push actual
    // conversation out of the window.
    function pickContextWindow(hist, depth, uptoIdx) {
        const full = (Number.isInteger(uptoIdx) ? hist.slice(0, uptoIdx) : hist.slice());
        const kept = [];
        let turns = 0;
        for (let i = full.length - 1; i >= 0; i--) {
            kept.push(full[i]);
            if (full[i].role !== 'note') turns++;
            if (turns >= depth) break;
        }
        return kept.reverse();
    }

    // The agent is shown what it has already proposed but the user hasn't
    // applied, so it can revise a specific proposal (and mark the stale one with
    // a <supersede> tag) instead of blindly re-proposing. Numbers match the cards
    // (1-based by pendingEdits array position, which is stable — applied/skipped
    // edits are marked, not removed).
    function formatPendingProposals(edits) {
        const lines = [];
        (edits || []).forEach((e, i) => {
            if (!e || e.status !== 'pending') return;
            const tgt = e.docName ? ' \u2192 ' + e.docName : '';
            const kind = e.type === 'replace_all' ? 'full rewrite' : e.type === 'append' ? 'append' : e.type === 'insert' ? 'insert after' : 'replace';
            lines.push('Edit ' + (i + 1) + ' (' + kind + tgt + '): ' + oneLine(e.reason || '(no reason given)').slice(0, 160));
        });
        if (!lines.length) return '';
        return [
            '[PENDING PROPOSALS \u2014 you already proposed these and the user has NOT applied them yet]',
            ...lines,
            'If your next reply is a better version of one of these (the same change, improved) rather than a separate new change, put a supersede tag naming the stale one(s) just before your docedits block \u2014 e.g. <supersede>1</supersede> or <supersede>1,2</supersede> \u2014 so it is auto-skipped and the user never applies both. If you are adding a genuinely new, independent change, do not supersede. Do not resend a proposal that has not changed.',
            '[/PENDING PROPOSALS]',
        ].join('\n');
    }

    function pendingProposalsBlock() {
        return formatPendingProposals(pendingEdits);
    }

    // Parse a <supersede>...</supersede> tag from a reply: the edit numbers
    // (1-based, matching the cards) the agent is replacing. Tolerant of "1",
    // "1,2", "Edit 1", "[1, 2]", and newline-separated forms.
    function parseSupersede(text) {
        const m = String(text || '').match(/<supersede>([\s\S]*?)<\/supersede>/i);
        if (!m) return [];
        const nums = (m[1].match(/\d+/g) || []).map(Number).filter(n => Number.isInteger(n) && n >= 1);
        return [...new Set(nums)];
    }

    function buildMessages(doc, uptoIdx) {
        const preset = presetForDoc(doc);
        const sys = String(preset?.prompt || '').trim() + '\n\n' + DOCEDITS_PROTOCOL;
        const msgs = [{ role: 'system', content: sys }];

        const depth = Math.max(2, Number(settings.historyDepth) || 16);
        const hist = sess(doc).history;
        const base = pickContextWindow(hist, depth, uptoIdx);

        let lastUser = -1;
        for (let i = base.length - 1; i >= 0; i--) {
            if (base[i].role === 'user') { lastUser = i; break; }
        }
        base.forEach((h, i) => {
            let content = String(h.content ?? '');
            if (h.role === 'note') { msgs.push({ role: 'user', content: '[STATE] ' + content }); return; }
            if (i === lastUser) {
                const extra = [contextBlocks(doc), pendingProposalsBlock()].filter(Boolean).join('\n\n');
                content = extra + '\n\n' + content;
            }
            msgs.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content });
        });
        return msgs;
    }

    // Estimate the total context this session sends on the next message — exactly
    // what buildMessages assembles: system prompt + edit protocol, the document,
    // any 🔗 references (sent in full), and the windowed conversation history.
    // Returns a breakdown so the readout can attribute where the tokens go.
    function contextTokenBreakdown(doc) {
        if (!doc) return { system: 0, doc: 0, refs: [], refsTotal: 0, history: 0, turns: 0, notes: 0, proposals: 0, winLen: 0, total: 0 };
        const preset = presetForDoc(doc);
        const system = estTokens(String(preset?.prompt || '').trim() + '\n\n' + DOCEDITS_PROTOCOL);
        const docTok = estTokens(docBlock(doc));
        const refs = refsOf(doc).map(r => ({ name: r.name || 'Untitled', tokens: estTokens(refBlock(r)) }));
        const refsTotal = refs.reduce((n, r) => n + r.tokens, 0);
        const depth = Math.max(2, Number(settings.historyDepth) || 16);
        const win = pickContextWindow(sess(doc).history, depth);
        let history = 0, turns = 0, notes = 0;
        for (const h of win) {
            if (h.role === 'note') { history += estTokens('[STATE] ' + String(h.content ?? '')); notes++; }
            else { history += estTokens(String(h.content ?? '')); turns++; }
        }
        const proposals = estTokens(pendingProposalsBlock());
        return { system, doc: docTok, refs, refsTotal, history, turns, notes, proposals, winLen: win.length, total: system + docTok + refsTotal + history + proposals };
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
        const sessAtStart = sess(doc)?.id;
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
            if (activeDoc()?.id !== docAtStart || sess(activeDoc())?.id !== sessAtStart) {
                addBubble('note', 'Reply discarded \u2014 document or session switched during generation.');
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
                const entry = sess(doc).history[opts.swipeIdx];
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
            // The agent can mark earlier still-pending proposals it is replacing.
            let supersededCount = 0;
            for (const n of parseSupersede(reply)) {
                const e = pendingEdits[n - 1];
                if (e && e.status === 'pending') { e.status = 'superseded'; supersededCount++; }
            }
            if (Number.isInteger(opts.swipeIdx)) {
                // A swipe is an ALTERNATE version of one reply, not a new idea:
                // replace that reply's cards (drop its old batch, stage the new).
                pendingEdits = pendingEdits.filter(e => e.status !== 'pending' || e.fromSwipe !== opts.swipeIdx);
                if (parsed.edits.length) {
                    editBatchSeq++;
                    for (const e of parsed.edits) { e.batch = editBatchSeq; e.fromSwipe = opts.swipeIdx; }
                    pendingEdits = pendingEdits.concat(parsed.edits);
                    editsCollapsed = false;
                }
            } else if (parsed.edits.length) {
                // A fresh reply: STACK its proposals below anything still pending,
                // so you can discuss, get a refinement, and compare both.
                const stillPending = pendingEdits.filter(e => e.status === 'pending').length;
                editBatchSeq++;
                for (const e of parsed.edits) e.batch = editBatchSeq;
                pendingEdits = pendingEdits.concat(parsed.edits);
                editsCollapsed = false;
                if (stillPending) {
                    addBubble('note', '\u2795 ' + parsed.edits.length + ' new proposal(s) staged below your ' + stillPending + ' still-pending one(s) \u2014 compare and Apply the ones you want.');
                }
            }
            if (supersededCount) {
                addBubble('note', '\u21A9 Auto-skipped ' + supersededCount + ' earlier proposal(s) the agent replaced.');
            }
            // A chat-only reply (no edits) leaves staged cards untouched.
            renderEditCards();
        } catch (err) {
            busy.remove();
            console.error(LOG, err);
            let emsg = String(err?.message || err);
            if (Number(settings.maxTokens) > 32768) emsg += ' \u2014 if this is a provider rejection, try lowering Max tokens.';
            addBubble('note', 'Error: ' + emsg);
            toast(emsg, 'error');
        } finally {
            running = false;
            setBusy(false);
        }
    }

    async function swipeAssistant(idx, dir) {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        const h = sess(doc).history;
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
            pendingEdits = pendingEdits.filter(e => e.status !== 'pending' || e.fromSwipe !== idx);
            if (pe.edits.length) {
                editBatchSeq++;
                for (const e of pe.edits) { e.batch = editBatchSeq; e.fromSwipe = idx; }
                pendingEdits = pendingEdits.concat(pe.edits);
                editsCollapsed = false;
            }
            renderEditCards();
            return;
        }
        await runGeneration({ swipeIdx: idx });
    }

    async function retryLast() {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        const h = sess(doc).history;
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
        const h = sess(doc).history;
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
        const h = sess(doc).history;
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
        const h = sess(doc).history;
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
        const cur = sess(doc);
        if (!confirm('Clear session "' + cur.name + '" of "' + doc.name + '"? The document itself is untouched.')) return;
        cur.history = [];
        persist();
        pendingEdits = [];
        renderHistory();
        renderEditCards();
    }

    // ------------------------------------------------------------------
    // Draggable floating editor window (fully inline-styled: a stale cached
    // CSS file must never be able to break this — learned the hard way)
    // ------------------------------------------------------------------

    // Drag via window-level move/up listeners instead of pointer capture on
    // the handle: setPointerCapture is unreliable in Android WebViews and a
    // failed capture makes the panel undraggable. Position is frozen to
    // explicit left/top the instant a drag starts, so CSS right/bottom
    // anchoring (the phone layout) can never fight the drag either.
    // Accepts one handle or an array of handles (drag-from-anywhere zones).
    function makeDraggable(box, handles) {
        const list = Array.isArray(handles) ? handles : [handles];
        let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, pid = null;
        const onMove = (e) => {
            if (!dragging || (pid !== null && e.pointerId !== undefined && e.pointerId !== pid)) return;
            e.preventDefault();
            const nx = Math.min(Math.max(0, ox + e.clientX - sx), window.innerWidth - 60);
            const ny = Math.min(Math.max(0, oy + e.clientY - sy), window.innerHeight - 40);
            box.style.left = nx + 'px';
            box.style.top = ny + 'px';
        };
        const onUp = (e) => {
            if (pid !== null && e.pointerId !== undefined && e.pointerId !== pid) return;
            dragging = false;
            pid = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
        for (const h of list) {
            if (!h) continue;
            try { h.style.touchAction = 'none'; } catch (e) { /* ignore */ }
            h.addEventListener('pointerdown', (e) => {
                if (e.target.closest('button, select, input, textarea, a, label, .la_hbtn, .la_bubble, .la_card')) return;
                dragging = true;
                pid = (e.pointerId !== undefined) ? e.pointerId : null;
                sx = e.clientX; sy = e.clientY;
                const r = box.getBoundingClientRect();
                ox = r.left; oy = r.top;
                box.style.left = ox + 'px';
                box.style.top = oy + 'px';
                box.style.right = 'auto';
                box.style.bottom = 'auto';
                window.addEventListener('pointermove', onMove, { passive: false });
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
            });
        }
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
            const fileBtn = document.createElement('button');
            fileBtn.id = 'la_viewer_file';
            fileBtn.textContent = 'File';
            fileBtn.title = 'Load a text file from your device (.md, .txt, .json, .yaml, \u2026) \u2014 replaces the text in this window';
            fileBtn.style.cssText = btnStyle;
            const fileIn = document.createElement('input');
            fileIn.id = 'la_viewer_filein';
            fileIn.type = 'file';
            fileIn.accept = '.md,.markdown,.txt,.text,.json,.yaml,.yml,.xml,.toml,.ini,.csv,.log,text/*,application/json,application/x-yaml,application/xml';
            fileIn.style.cssText = 'display:none;';
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
            head.appendChild(fileBtn);
            head.appendChild(pasteBtn);
            head.appendChild(copyBtn);
            head.appendChild(saveBtn);
            head.appendChild(closeBtn);
            box.appendChild(fileIn);

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
            fileBtn.addEventListener('click', () => { fileIn.value = ''; fileIn.click(); });
            fileIn.addEventListener('change', async () => {
                const f = fileIn.files && fileIn.files[0];
                if (!f) return;
                if (ta.value.trim() && !confirm('Replace the text in this window with the contents of "' + f.name + '"?')) return;
                let text = '';
                try {
                    text = typeof f.text === 'function' ? await f.text() : '';
                } catch (e) { /* fall through to FileReader */ }
                if (!text) {
                    text = await new Promise((resolve) => {
                        try {
                            const r = new FileReader();
                            r.onload = () => resolve(String(r.result || ''));
                            r.onerror = () => resolve('');
                            r.readAsText(f);
                        } catch (e) { resolve(''); }
                    });
                }
                if (!text) { toast('Could not read "' + f.name + '" as text.', 'error'); return; }
                ta.value = text;
                updateCount();
                const nameIn2 = el('la_viewer_name');
                if (nameIn2 && el('la_viewer_namerow').style.display !== 'none') nameIn2.value = f.name;
                toast('Loaded "' + f.name + '" (' + text.length.toLocaleString() + ' chars). Press ' + el('la_viewer_save').textContent + ' to keep it.', 'success');
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
        ta.readOnly = !!opts.readonlyNote;
        ta.style.opacity = opts.readonlyNote ? '0.92' : '1';
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
    // Sessions: parallel conversations per document, with branching
    // ------------------------------------------------------------------

    function renderSessions() {
        const sel = el('la_sess');
        if (!sel) return;
        const doc = activeDoc();
        sel.innerHTML = '';
        if (!doc) { sel.disabled = true; return; }
        sel.disabled = false;
        for (const sx of doc.sessions) {
            const o = document.createElement('option');
            o.value = String(sx.id);
            o.textContent = '\uD83D\uDCAC ' + (oneLine(sx.name).slice(0, 30) || ('Session ' + sx.id));
            sel.appendChild(o);
        }
        sel.value = String(doc.activeSessionId);
    }

    function switchSession(id) {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        const n = Number(id);
        if (!doc.sessions.some(sx => sx.id === n)) return;
        doc.activeSessionId = n;
        persist();
        renderSessions();
        renderHistory();
        renderEditCards();
    }

    function newSession() {
        if (running) return;
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const nid = nextSessId(doc);
        const v = prompt('Name for the new session:', 'Session ' + nid);
        if (v === null) return;
        doc.sessions.push({ id: nid, name: v.trim() || ('Session ' + nid), history: [] });
        switchSession(nid);
    }

    // Branch: copy the current session up to (and including) message idx into
    // a fresh session and switch to it. Omitting idx copies the whole session.
    function branchAt(idx) {
        if (running) return;
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const cur = sess(doc);
        const upTo = Number.isInteger(idx) ? idx : cur.history.length - 1;
        const copy = JSON.parse(JSON.stringify(cur.history.slice(0, upTo + 1)));
        const nid = nextSessId(doc);
        doc.sessions.push({ id: nid, name: oneLine(cur.name).slice(0, 20) + ' \u00BB' + nid, history: copy });
        switchSession(nid);
        toast('Branched into a new session (' + copy.length + ' message(s) copied). The original session is untouched.', 'success');
    }

    function renameSession() {
        const doc = activeDoc();
        if (!doc) return;
        const cur = sess(doc);
        const v = prompt('Rename session:', cur.name);
        if (v === null) return;
        cur.name = v.trim() || cur.name;
        persist();
        renderSessions();
    }

    function deleteSession() {
        if (running) return;
        const doc = activeDoc();
        if (!doc) return;
        const cur = sess(doc);
        if (!confirm('Delete session "' + cur.name + '" (' + cur.history.length + ' message(s))? The document itself is untouched.')) return;
        doc.sessions = doc.sessions.filter(sx => sx.id !== cur.id);
        if (!doc.sessions.length) doc.sessions.push({ id: 1, name: 'Session 1', history: [] });
        doc.activeSessionId = doc.sessions[0].id;
        persist();
        renderSessions();
        renderHistory();
        renderEditCards();
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

    function newWorldbook() {
        const v = prompt('Name for the new worldbook:', 'Worldbook');
        if (v === null) return;
        const d = makeDoc((v.trim() || 'Worldbook') + (/\.json$/i.test(v) ? '' : '.json'), '[]');
        d.presetId = PRESET_WB_ID;
        settings.docs.push(d);
        setActiveDoc(d.id);
        persist();
        renderAll();
        toast('Created worldbook "' + d.name + '". Attach your Plot Essential via \uD83D\uDD17 so entries stay consistent, then ask the agent to add entries.', 'success');
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
        d.refs = Array.isArray(doc.refs) ? doc.refs.slice() : [];
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
        for (const d of settings.docs) {
            if (Array.isArray(d.refs)) d.refs = d.refs.filter(x => x !== doc.id);
        }
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
        const nm = (doc.name || 'document').trim();
        const suggested = /\.[a-z0-9]{1,8}$/i.test(nm) ? nm : nm + '.md';
        const v = prompt('Export as (any extension: .md, .json, .yaml, .txt \u2026):', suggested);
        if (v === null) return;
        const fname = v.trim() || suggested;
        const ok = downloadText(fname, doc.text);
        toast(ok ? 'Downloading "' + safeFileName(fname) + '"\u2026' : 'Download failed \u2014 use Copy instead.', ok ? 'success' : 'error');
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
        const isWB = docLooksLikeWorldbook(doc);
        if (isWB) {
            showWorldbookManager(doc.id);
            return;
        }
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

    function viewDocRaw(id) {
        const doc = settings.docs.find(x => x.id === id) || activeDoc();
        if (!doc) return;
        showEditor({
            title: '\uD83D\uDCC4 ' + doc.name + ' (raw JSON)',
            text: doc.text,
            saveLabel: 'Save',
            bound: { kind: 'doc', id: doc.id },
            onSave: (text) => {
                const d = settings.docs.find(x => x.id === doc.id);
                if (!d) { toast('Document no longer exists.', 'error'); return; }
                if (text === d.text) { toast('No changes.', 'info'); return; }
                const chk = parseWorldbook(text);
                if (chk.error) {
                    if (!confirm('This is not valid worldbook JSON (' + chk.error + '). Save anyway?')) return;
                }
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
            '  <div class="la_htext">',
            '    <span class="la_title">\uD83D\uDCDC Plot Essential and Instructions Maker</span>',
            '    <span class="la_sub" id="la_sub"></span>',
            '  </div>',
            '  <span class="la_hbtn" id="la_full" title="Toggle fullscreen"><i class="fa-solid fa-expand"></i></span>',
            '  <span class="la_hbtn" id="la_gear" title="Settings"><i class="fa-solid fa-gear"></i></span>',
            '  <span class="la_hbtn" id="la_close" title="Close"><i class="fa-solid fa-xmark"></i></span>',
            '</div>',
            '<div id="la_docbar">',
            '  <div class="la_dbrow">',
            '    <select id="la_doc" title="Active document"></select>',
            '    <select id="la_sess" title="Conversation session \u2014 branch to explore alternatives without losing the original"></select>',
            '    <button class="la_btn" id="la_manage" title="Show document / session / preset management">\u22EE</button>',
            '  </div>',
            '  <div id="la_manage_area">',
            '    <div class="la_dbrow">',
            '      <select id="la_preset" title="Agent preset (brain) for this document"></select>',
            '      <button class="la_btn" id="la_refs" title="Attach other documents as read-only references for this conversation">\uD83D\uDD17<span id="la_refcount">0</span></button>',
            '      <button class="la_btn" id="la_view" title="View/Edit the document in a window">\uD83D\uDC41 View</button>',
            '      <button class="la_btn" id="la_cmp" title="Compare 2\u20134 documents side by side">\u2696 Cmp</button>',
            '    </div>',
            '    <div class="la_dbrow la_grp">',
            '      <span class="la_grplbl" title="Document actions">Doc</span>',
            '      <button class="la_btn" id="la_new" title="New empty document">+ New</button>',
            '      <button class="la_btn" id="la_newwb" title="New worldbook (JSON, assigned to the Worldbook Maker preset)">+WB</button>',
            '      <button class="la_btn" id="la_dren" title="Rename document">Ren</button>',
            '      <button class="la_btn" id="la_dup" title="Duplicate document (text + preset, fresh conversation)">Dup</button>',
            '      <button class="la_btn" id="la_ddel" title="Delete document">Del</button>',
            '      <button class="la_btn" id="la_imp" title="Import: pick a file (.md / .json / .yaml \u2026) or paste text">Imp</button>',
            '      <button class="la_btn" id="la_exp" title="Export: download with a chosen filename/extension">Exp</button>',
            '      <button class="la_btn" id="la_wbexp" title="Export as SillyTavern World Info (.json) \u2014 for worldbook documents">\uD83C\uDF10\u2192ST</button>',
            '      <button class="la_btn" id="la_dcopy" title="Copy the whole document to the clipboard">\uD83D\uDCCB</button>',
            '      <button class="la_btn" id="la_lint" title="Check the raw text deterministically: double-spaces, trailing whitespace, JSON validity (in code, not via the AI)">\uD83D\uDD0D Check</button>',
            '    </div>',
            '    <div class="la_dbrow la_grp">',
            '      <span class="la_grplbl" title="Session actions">Sess</span>',
            '      <button class="la_btn" id="la_sessnew" title="New empty session (fresh conversation, same document)">+ New</button>',
            '      <button class="la_btn" id="la_sessbr" title="Branch: copy this whole session into a new one">Branch</button>',
            '      <button class="la_btn" id="la_sessren" title="Rename this session">Ren</button>',
            '      <button class="la_btn" id="la_sessdel" title="Delete this session">Del</button>',
            '    </div>',
            '    <div class="la_dbrow" id="la_refbar" style="display:none;flex-direction:column;align-items:stretch;gap:4px;"></div>',
            '  </div>',
            '</div>',
            '<div id="la_settings"></div>',
            '<div id="la_log"></div>',
            '<div id="la_edits"></div>',
            '<div id="la_composer">',
            '  <div id="la_quick">',
            '    <button class="la_btn" id="la_retry" title="Regenerate the last agent reply (kept as a swipe)">\u21BB Retry</button>',
            '    <button class="la_btn" id="la_dellast" title="Delete the last question + answer">\u232B Del last</button>',
            '    <button class="la_btn" id="la_undo" title="Undo the last applied batch / manual save on this document">\u21B6 Undo</button>',
            '    <button class="la_btn" id="la_clear" title="Clear the agent conversation (document untouched)">\uD83E\uDDF9 Clear</button>',
            '  </div>',
            '  <div id="la_inputrow">',
            '    <textarea id="la_input" placeholder="e.g. draft a Plot Essential for a mage academy \u2014 or: change the magic system to blood-cost casting"></textarea>',
            '    <button class="la_btn la_primary" id="la_send">Send</button>',
            '  </div>',
            '</div>',
        ].join('\n');
        document.body.appendChild(panel);

        buildSettingsUI();
        makeDraggable(panel, [el('la_header'), el('la_docbar'), el('la_quick')]);

        el('la_full').addEventListener('click', () => {
            settings.fullscreen = !settings.fullscreen;
            applyFullscreen();
            persist();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && settings.fullscreen && el('la_panel')?.classList.contains('la_open') && !anyFloatWinOpen()) {
                settings.fullscreen = false;
                applyFullscreen();
                persist();
            }
        });
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
        el('la_refs').addEventListener('click', () => {
            const bar = el('la_refbar');
            const show = !bar.style.display || bar.style.display === 'none';
            bar.style.display = show ? 'flex' : 'none';
            if (show) renderRefBar();
        });
        el('la_manage').addEventListener('click', () => {
            settings.barOpen = !settings.barOpen;
            applyManageState();
            persist();
        });
        applyManageState();
        el('la_sess').addEventListener('change', () => switchSession(el('la_sess').value));
        el('la_sessnew').addEventListener('click', () => newSession());
        el('la_sessbr').addEventListener('click', () => branchAt());
        el('la_sessren').addEventListener('click', () => renameSession());
        el('la_sessdel').addEventListener('click', () => deleteSession());
        el('la_new').addEventListener('click', () => newDoc());
        el('la_newwb').addEventListener('click', () => newWorldbook());
        el('la_dren').addEventListener('click', () => renameDoc());
        el('la_dup').addEventListener('click', () => dupDoc());
        el('la_ddel').addEventListener('click', () => deleteDoc());
        el('la_imp').addEventListener('click', () => importDoc());
        el('la_exp').addEventListener('click', () => exportDoc());
        el('la_wbexp').addEventListener('click', () => exportWorldbookST());
        el('la_dcopy').addEventListener('click', () => copyDoc());
        el('la_lint').addEventListener('click', () => showDocLint());
        el('la_view').addEventListener('click', () => viewDoc());
        el('la_cmp').addEventListener('click', () => showCompare());
        el('la_retry').addEventListener('click', () => retryLast());
        el('la_dellast').addEventListener('click', () => deleteLastExchange());
        el('la_undo').addEventListener('click', () => undoLast());
        const subEl = el('la_sub');
        if (subEl) { subEl.style.cursor = 'pointer'; subEl.title = 'Tap for a context breakdown (system / document / references / history)'; subEl.addEventListener('click', () => showContextBreakdown()); }
        el('la_clear').addEventListener('click', () => clearConversation());
    }

    function buildSettingsUI() {
        const box = el('la_settings');
        box.innerHTML = [
            '<label>LLM route (Connection Profile)</label>',
            '<select id="la_profile"></select>',
            '<div class="la_row">',
            '  <div><label>Max tokens (reply ceiling)</label><input type="number" id="la_maxtok" min="256" max="200000" step="256"></div>',
            '  <div><label>History depth (msgs sent)</label><input type="number" id="la_depth" min="2" max="80"></div>',
            '</div>',
            '<div class="la_hint">Max tokens is a ceiling, not a target \u2014 the model stops when done, and thinking counts against it, so high is good. If a provider rejects a request, lower it.</div>',
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
            '<div class="la_presetbtns" style="margin-top:10px;">',
            '  <button class="la_btn" id="la_set_close">✕ Close settings</button>',
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
        el('la_maxtok').addEventListener('change', () => { settings.maxTokens = Math.min(200000, Math.max(256, Number(el('la_maxtok').value) || 4096)); el('la_maxtok').value = settings.maxTokens; persist(); });
        el('la_depth').addEventListener('change', () => { settings.historyDepth = Math.max(2, Math.min(80, Number(el('la_depth').value) || 16)); el('la_depth').value = settings.historyDepth; persist(); updateSub(); });
        el('la_stream').addEventListener('change', () => { settings.streaming = el('la_stream').checked; persist(); });
        el('la_showthink').addEventListener('change', () => { settings.showThinking = el('la_showthink').checked; renderHistory(); persist(); });
        el('la_preset_prompt').addEventListener('input', () => {
            const p = presetForDoc(activeDoc());
            if (!p) return;
            p.prompt = el('la_preset_prompt').value;
            persist();
        });
        el('la_set_close').addEventListener('click', () => el('la_settings').classList.remove('la_open'));
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

    function kFmt(n) {
        n = Number(n) || 0;
        if (n < 1000) return String(n);
        return (n < 10000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)) + 'k';
    }

    function applyManageState() {
        const area = el('la_manage_area');
        const btn = el('la_manage');
        if (!area || !btn) return;
        const open = !!settings.barOpen;
        area.style.display = open ? 'flex' : 'none';
        btn.textContent = open ? '\u25B4' : '\u22EE';
        btn.title = (open ? 'Hide' : 'Show') + ' document / session / preset management';
        btn.classList.toggle('la_on', open);
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
                o.textContent = '\uD83D\uDCC4 ' + (oneLine(d.name).slice(0, 30) || 'Untitled') + ' \u00B7 ' + kFmt((d.text || '').length);
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
        const refsBtn = el('la_refs');
        if (refsBtn) refsBtn.disabled = !doc;
        const wbBtn = el('la_wbexp');
        if (wbBtn) wbBtn.style.display = (doc && docLooksLikeWorldbook(doc)) ? '' : 'none';
        updateRefCount();
    }

    function updateRefCount() {
        const c = el('la_refcount');
        if (!c) return;
        c.textContent = String(refsOf(activeDoc()).length);
    }

    function renderRefBar() {
        const bar = el('la_refbar');
        if (!bar) return;
        const doc = activeDoc();
        bar.innerHTML = '';
        if (!doc) {
            bar.innerHTML = '<span class="la_refhint">No document selected.</span>';
            return;
        }
        const hint = document.createElement('div');
        hint.className = 'la_refhint';
        hint.textContent = 'Read-only references \u2014 sent in full with every message (adds tokens). Edits target "' + doc.name + '" unless the agent names a reference; tell it e.g. "use Y as the base and merge X into it".';
        bar.appendChild(hint);
        const others = settings.docs.filter(d => d.id !== doc.id);
        if (!others.length) {
            const sp = document.createElement('span');
            sp.className = 'la_refhint';
            sp.textContent = 'No other documents exist yet.';
            bar.appendChild(sp);
            return;
        }
        for (const d of others) {
            const lab = document.createElement('label');
            lab.className = 'la_refitem';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = doc.refs.includes(d.id);
            cb.addEventListener('change', () => {
                if (cb.checked) { if (!doc.refs.includes(d.id)) doc.refs.push(d.id); }
                else doc.refs = doc.refs.filter(x => x !== d.id);
                persist();
                updateRefCount();
                updateSub();
            });
            const sp = document.createElement('span');
            sp.textContent = oneLine(d.name).slice(0, 34) + '  (' + (d.text || '').length.toLocaleString() + ' chars)';
            lab.appendChild(cb);
            lab.appendChild(sp);
            bar.appendChild(lab);
        }
    }

    function updateSub() {
        const ub = el('la_undo');
        if (ub) {
            const d0 = activeDoc();
            const n = d0 && Array.isArray(d0.undo) ? d0.undo.length : 0;
            ub.textContent = '\u21B6 Undo' + (n ? ' (' + n + ')' : '');
            ub.disabled = !n;
        }
        const sub = el('la_sub');
        if (!sub) return;
        const doc = activeDoc();
        const refN = refsOf(doc).length;
        if (doc) {
            const ctx = contextTokenBreakdown(doc).total;
            sub.textContent = 'v' + VERSION + ' \u00B7 ' + oneLine(doc.name).slice(0, 24) + ' \u00B7 ' + (doc.text || '').length.toLocaleString() + ' chars' + (refN ? ' +' + refN + ' ref' + (refN > 1 ? 's' : '') : '') + ' \u00B7 ~' + kFmt(ctx) + ' ctx';
        } else {
            sub.textContent = 'v' + VERSION + ' \u00B7 no document';
        }
    }

    function setBusy(b) {
        const btn = el('la_send');
        if (btn) {
            btn.textContent = b ? 'Stop' : 'Send';
            btn.style.background = b ? 'rgba(220,90,90,0.85)' : '';
        }
        for (const id of ['la_retry', 'la_dellast', 'la_clear', 'la_new', 'la_dren', 'la_dup', 'la_ddel', 'la_imp', 'la_sessnew', 'la_sessbr', 'la_sessren', 'la_sessdel']) {
            const x = el(id);
            if (x) x.disabled = b;
        }
        const dsel = el('la_doc');
        if (dsel) dsel.disabled = b;
        const ssel = el('la_sess');
        if (ssel) ssel.disabled = b;
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
        if (kind === 'user' || kind === 'ai' || kind === 'assistant') {
            mk('\uD83C\uDF3F', 'Branch: new session continuing from this message (this session stays untouched)', () => branchAt(hidx));
        }
        mk('\uD83D\uDCCB', 'Copy message text', async () => {
            const doc = activeDoc();
            const h = sess(doc)?.history?.[hidx];
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

    // Explicit JS toggle instead of a native <details> dropdown: the native
    // widget silently failed to expand on Android (theme/browser CSS can eat
    // it), and this is the only reliable pattern on that device. Inline
    // styles on purpose so no cached or theme CSS can break it either.
    function makeThinkBox(think) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'margin-bottom:6px;';
        const label = () => '\uD83E\uDDE0 thinking (' + think.length.toLocaleString() + ' chars) ';
        const head = document.createElement('div');
        head.textContent = label() + '\u25B8';
        head.title = 'Tap to show/hide the thinking';
        head.style.cssText = 'cursor:pointer;font-size:0.85em;font-style:italic;opacity:0.75;user-select:none;';
        const body = document.createElement('div');
        body.textContent = think;
        body.style.cssText = 'display:none;white-space:pre-wrap;word-break:break-word;border-left:2px solid rgba(255,255,255,0.35);padding-left:8px;margin:4px 0 6px;opacity:0.85;font-size:0.85em;max-height:40vh;overflow-y:auto;';
        head.addEventListener('click', (e) => {
            e.stopPropagation();
            const open = body.style.display === 'none';
            body.style.display = open ? 'block' : 'none';
            head.textContent = label() + (open ? '\u25BE' : '\u25B8');
        });
        wrap.appendChild(head);
        wrap.appendChild(body);
        return wrap;
    }

    function addAiBubble(rest, think, hidx) {
        const log = el('la_log');
        if (!log) return document.createElement('div');
        const div = document.createElement('div');
        div.className = 'la_bubble la_ai';
        if (settings.showThinking && think) div.appendChild(makeThinkBox(think));
        const body = document.createElement('div');
        body.textContent = stripBlocks(rest) || '(no text)';
        div.appendChild(body);
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
        const hist = sess(doc).history;
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

    function statusCls(st) {
        st = String(st || '');
        if (st.indexOf('fuzzy') !== -1) return 'la_st_fuzzy';
        if (st.indexOf('applied') === 0) return 'la_st_ok';
        if (st.indexOf('failed') === 0) return 'la_st_fail';
        return 'la_st_skip';
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

        const pendingList = pendingEdits.filter(e => e.status === 'pending');
        const pendingCount = pendingList.length;
        const batches = [...new Set(pendingList.map(e => e.batch || 0))];
        const head = document.createElement('div');
        head.className = 'la_edits_head';
        head.innerHTML = '<span>Proposed edits: ' + pendingEdits.length + (pendingCount !== pendingEdits.length ? ' (' + pendingCount + ' pending)' : '') + '</span>' +
            '<button class="la_btn" id="la_toggleedits">' + (editsCollapsed ? 'Show' : 'Hide') + '</button>' +
            (batches.length > 1 ? '<button class="la_btn" id="la_applynewest" title="Apply only the newest batch of proposals">Apply newest</button>' : '') +
            '<button class="la_btn la_primary" id="la_applyall">Apply all pending</button>' +
            '<button class="la_btn" id="la_dismissall">Dismiss</button>';
        frag.appendChild(head);

        const list = document.createElement('div');
        if (editsCollapsed) list.style.display = 'none';
        const frag_list_append = (node) => list.appendChild(node);

        const maxBatch = Math.max(0, ...pendingEdits.map(e => e.batch || 0));
        let lastBatch = null;
        pendingEdits.forEach((edit, idx) => {
            const bt = edit.batch || 0;
            if (bt !== lastBatch && maxBatch > 0) {
                const div = document.createElement('div');
                div.className = 'la_batchsep';
                div.textContent = bt === maxBatch
                    ? '\u25BC newest proposals' + (lastBatch !== null ? ' (compare with above)' : '')
                    : '\u25B2 earlier proposals';
                frag_list_append(div);
                lastBatch = bt;
            }
            const card = document.createElement('div');
            card.className = 'la_card';
            const findShown = edit.type === 'append'
                ? '(end of document)'
                : edit.type === 'replace_all'
                    ? '(entire document \u2014 full rewrite)'
                    : edit.find;
            card.innerHTML =
                '<div class="la_card_top"><b>Edit ' + (idx + 1) + ' \u00B7 ' + editTypeLabel(edit) + (edit.docName ? ' \u2192 ' + esc(edit.docName) : '') + '</b>' +
                (edit.status === 'pending'
                    ? '<button class="la_btn la_apply" data-la-apply="' + idx + '">Apply</button><button class="la_btn la_skip" data-la-skip="' + idx + '">Skip</button>'
                    : '') +
                '</div>' +
                (edit.reason ? '<div class="la_card_reason">' + esc(edit.reason) + '</div>' : '') +
                '<div class="la_diff la_before">' + esc(findShown) + '</div>' +
                '<div class="la_diff la_after">' + esc(edit.replace) + '</div>' +
                (edit.status !== 'pending' ? '<div class="la_card_status ' + statusCls(edit.status) + '">' + esc(edit.status) + '</div>' : '');
            list.appendChild(card);
        });

        frag.appendChild(list);
        box.innerHTML = '';
        box.appendChild(frag);

        el('la_applyall')?.addEventListener('click', () => applyEdits(pendingEdits));
        el('la_applynewest')?.addEventListener('click', () => {
            const mb = Math.max(0, ...pendingEdits.map(e => e.batch || 0));
            applyEdits(pendingEdits.filter(e => (e.batch || 0) === mb));
        });
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
        renderSessions();
        const rb = el('la_refbar');
        if (rb && rb.style.display !== 'none') renderRefBar();
        refreshPresetTools();
        renderHistory();
        renderEditCards();
        updateSub();
    }

    function applyFullscreen() {
        const panel = el('la_panel');
        if (!panel) return;
        const on = !!settings.fullscreen;
        panel.classList.toggle('la_full', on);
        const ic = el('la_full')?.querySelector('i');
        if (ic) ic.className = on ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
        const btn = el('la_full');
        if (btn) btn.title = on ? 'Exit fullscreen' : 'Fullscreen';
        if (on) {
            // Clear any inline drag offsets so the CSS fullscreen rules win.
            panel.style.left = '';
            panel.style.top = '';
            panel.style.right = '';
            panel.style.bottom = '';
            panel.style.width = '';
            panel.style.height = '';
        }
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
            applyFullscreen();
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
        div.title = 'Toggle Plot Essential and Instructions Maker';
        div.innerHTML = '<i class="fa-solid fa-scroll"></i><span>Plot Essential and Instructions Maker</span>';
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
                c.registerSlashCommand('lore', handler, [], '<span>\u2014 toggle Plot Essential and Instructions Maker / send it a request</span>', true, true);
                return;
            }
        } catch (e) { /* ignore */ }
        try {
            if (c.SlashCommandParser?.addCommandObject && c.SlashCommand?.fromProps) {
                c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({
                    name: 'lore',
                    callback: handler,
                    helpString: 'Toggle Plot Essential and Instructions Maker, or send it a request: /lore change the magic system to blood-cost casting',
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

    // ------------------------------------------------------------------
    // Worldbook engine: parse the document's JSON entry array, and convert
    // to SillyTavern World Info JSON for one-click import.
    // ------------------------------------------------------------------

    // Map friendly position strings (and ST's numeric codes) to a canonical
    // token. ST position codes: 0 before-char, 1 after-char, 2 top-AN,
    // 3 bottom-AN, 4 at-depth. We support the three that make sense for lore.
    function normalizePosition(p) {
        if (typeof p === 'number') {
            if (p === 0) return 'before_char';
            if (p === 4) return 'at_depth';
            return 'after_char';
        }
        const v = String(p || '').toLowerCase().replace(/^@/, '').replace(/[\s-]+/g, '_');
        if (v === 'before_char' || v === 'before' || v === 'before_char_defs' || v === 'wibefore') return 'before_char';
        if (v === 'at_depth' || v === 'depth' || v === 'atdepth' || v === 'in_chat') return 'at_depth';
        if (v === 'after_char' || v === 'after' || v === 'after_char_defs' || v === 'wiafter' || v === '') return 'after_char';
        return 'after_char';
    }

    function positionToST(pos) {
        if (pos === 'before_char') return 0;
        if (pos === 'at_depth') return 4;
        return 1; // after_char
    }

    // Rough token estimate (~4 chars/token for English prose). Deliberately an
    // approximation — labelled with ~ everywhere it surfaces. Only an entry's
    // content is injected at runtime, so that is what we count for budget.
    function estTokens(s) {
        const t = String(s || '');
        if (!t) return 0;
        return Math.max(1, Math.ceil(t.length / 4));
    }

    // Budget summary for a worldbook. `alwaysOn` is the permanent cost: blue
    // (constant) entries are in context every single message, so that subtotal
    // is the one to watch. `total` is the worst case if everything fired at once.
    function worldbookTokenStats(entries) {
        const list = (entries || []).map(e => ({
            name: e.name || '(unnamed)',
            strategy: e.strategy,
            tokens: estTokens(e.content),
        }));
        const total = list.reduce((n, e) => n + e.tokens, 0);
        const alwaysOn = list.filter(e => e.strategy === 'blue').reduce((n, e) => n + e.tokens, 0);
        const blueCount = list.filter(e => e.strategy === 'blue').length;
        return { perEntry: list, total, alwaysOn, blueCount, count: list.length };
    }

    // Serialize parsed entries back to the canonical friendly document format
    // (the shape the Worldbook Maker prompt authors). Required fields always
    // emitted; optional fields only when they differ from the safe default, so
    // the JSON stays readable. This is the inverse of parseWorldbook for the
    // fields that matter, and the backbone of Repair + per-entry editing.
    function serializeWorldbook(entries) {
        const arr = (entries || []).map(e => {
            const o = {
                name: e.name || '(unnamed)',
                keys: Array.isArray(e.keys) ? e.keys : [],
                content: String(e.content || ''),
                strategy: ['blue', 'green', 'chain'].includes(e.strategy) ? e.strategy : 'green',
            };
            const order = numOr(e.order, 100);
            if (order !== 100) o.order = order;
            const pos = normalizePosition(e.position);
            if (pos !== 'after_char') o.position = pos;
            if (pos === 'at_depth') {
                const depth = Math.max(0, Math.round(numOr(e.depth, 4)));
                if (depth !== 4) o.depth = depth;
            }
            const prob = Math.max(0, Math.min(100, numOr(e.probability, 100)));
            if (prob !== 100) o.probability = prob;
            if (e.comment) o.comment = String(e.comment);
            return o;
        });
        return JSON.stringify(arr, null, 2);
    }

    // Parse a worldbook document (a JSON array of entry objects). Tolerant of
    // a top-level array or an object with an `entries` array. Returns
    // {entries:[...], error?:string}. Never throws.
    function parseWorldbook(text) {
        const raw = String(text || '').trim();
        if (!raw) return { entries: [] };
        let data;
        try { data = JSON.parse(raw); }
        catch (e) {
            try { data = JSON.parse(raw.replace(/,\s*([\]}])/g, '$1')); }
            catch (e2) { return { entries: [], error: 'not valid JSON: ' + e2.message }; }
        }
        let arr = null;
        if (Array.isArray(data)) arr = data;
        else if (data && Array.isArray(data.entries)) arr = data.entries;
        else if (data && data.entries && typeof data.entries === 'object') arr = Object.values(data.entries); // ST format: entries keyed by index
        if (!arr) return { entries: [], error: 'expected a JSON array of entries' };
        const entries = [];
        for (const e of arr) {
            if (!e || typeof e !== 'object') continue;
            const name = String(e.name ?? e.comment ?? '').trim();
            let keys = [];
            if (Array.isArray(e.keys)) keys = e.keys.map(k => String(k).trim()).filter(Boolean);
            else if (typeof e.keys === 'string') keys = e.keys.split(',').map(k => k.trim()).filter(Boolean);
            else if (Array.isArray(e.key)) keys = e.key.map(k => String(k).trim()).filter(Boolean);
            let strat = String(e.strategy || '').toLowerCase();
            if (!['blue', 'green', 'chain'].includes(strat)) {
                // infer: constant->blue, explicit vectorized->chain, else green
                if (e.constant === true) strat = 'blue';
                else if (e.vectorized === true && (!keys.length)) strat = 'chain';
                else strat = 'green';
            }
            entries.push({
                name: name || '(unnamed)',
                keys,
                content: String(e.content ?? '').trim(),
                strategy: strat,
                order: numOr(e.order, 100),
                position: normalizePosition(e.position),
                depth: Math.max(0, Math.round(numOr(e.depth, 4))),
                probability: Math.max(0, Math.min(100, numOr(e.probability, 100))),
                comment: String(e.comment ?? '').trim(),
            });
        }
        return { entries };
    }

    // Author-facing lint: surface problems without blocking (empty keys on a
    // green entry, duplicate names, empty content). Returns array of strings.
    function lintWorldbook(entries) {
        const warns = [];
        const seen = new Map();
        entries.forEach((e, i) => {
            const label = '"' + (e.name || ('#' + (i + 1))) + '"';
            if (e.strategy === 'green' && !e.keys.length) warns.push(label + ': green entry has no keys \u2014 it will never fire on keywords.');
            if (!e.content) warns.push(label + ': empty content.');
            const k = (e.name || '').toLowerCase();
            if (k) { if (seen.has(k)) warns.push('duplicate name ' + label + '.'); else seen.set(k, i); }
        });
        return warns;
    }

    // Convert parsed entries to SillyTavern World Info format:
    // { entries: { "0": {uid, key, keysecondary, comment, content, constant,
    //   vectorized, selective, order, position, disable, ...}, ... } }
    // Mapping: blue -> constant:true; green -> keyed selective + vectorized:true
    // (so it also fires semantically when the user has vectors on); chain ->
    // vectorized:true with no keys (pure semantic). This matches ST's schema.
    function worldbookToST(entries) {
        const out = { entries: {} };
        entries.forEach((e, i) => {
            const blue = e.strategy === 'blue';
            const chain = e.strategy === 'chain';
            const keys = (blue || chain) ? [] : e.keys.slice();
            const pos = positionToST(e.position);
            const prob = Number.isFinite(e.probability) ? e.probability : 100;
            out.entries[String(i)] = {
                uid: i,
                key: keys,
                keysecondary: [],
                comment: e.name || '',
                content: e.content || '',
                constant: blue,                       // blue = always on
                vectorized: chain || (!blue),         // green + chain are vector-eligible; blue is not
                selective: !blue && keys.length > 0,  // keyword-selective when it has keys
                selectiveLogic: 0,
                addMemo: true,
                order: Number.isFinite(e.order) ? e.order : 100,
                position: pos,                         // 0 before-char, 1 after-char, 4 at-depth
                disable: false,
                excludeRecursion: false,
                preventRecursion: false,
                delayUntilRecursion: false,
                probability: prob,
                useProbability: prob !== 100,
                depth: pos === 4 ? (Number.isFinite(e.depth) ? e.depth : 4) : 4,
                group: '',
                groupOverride: false,
                groupWeight: 100,
                scanDepth: null,
                caseSensitive: null,
                matchWholeWords: null,
                useGroupScoring: null,
                automationId: '',
                role: null,
                sticky: 0,
                cooldown: 0,
                delay: 0,
                displayIndex: i,
            };
        });
        return out;
    }

    function docLooksLikeWorldbook(doc) {
        if (!doc) return false;
        if (doc.presetId === PRESET_WB_ID) return true;
        const t = String(doc.text || '').trim();
        if (!t || t[0] !== '[' && t[0] !== '{') return false;
        const p = parseWorldbook(t);
        return !p.error && p.entries.length > 0 && p.entries.some(e => e.keys.length || e.strategy === 'blue');
    }

    function exportWorldbookST() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const p = parseWorldbook(doc.text);
        if (p.error) { toast('Not a valid worldbook: ' + p.error + ' \u2014 ask the agent to fix the JSON.', 'error'); return; }
        if (!p.entries.length) { toast('No worldbook entries found in this document.', 'warning'); return; }
        const warns = lintWorldbook(p.entries);
        const st = worldbookToST(p.entries);
        const json = JSON.stringify(st, null, 2);
        const base = /\.json$/i.test(doc.name) ? doc.name.replace(/\.json$/i, '') : doc.name;
        const ok = downloadText(safeFileName(base) + '.json', json);
        const counts = p.entries.reduce((a, e) => { a[e.strategy] = (a[e.strategy] || 0) + 1; return a; }, {});
        let msg = ok
            ? 'Exported ' + p.entries.length + ' entr' + (p.entries.length === 1 ? 'y' : 'ies') + ' as SillyTavern World Info ('
                + Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', ') + '). Import via ST \u2192 World Info \u2192 Import.'
            : 'Export failed \u2014 use Copy on the document and paste into a .json file.';
        toast(msg, ok ? 'success' : 'error');
        if (warns.length) addBubble('note', 'Worldbook export warnings:\n\u2022 ' + warns.slice(0, 8).join('\n\u2022 ') + (warns.length > 8 ? '\n\u2022 \u2026and ' + (warns.length - 8) + ' more' : ''));
    }

    // ------------------------------------------------------------------
    // Generic floating window shell (inline-styled — a stale cached CSS file
    // must never break these overlays). Reused by the worldbook manager and
    // the compare view. Backdrop + draggable header + scrollable body.
    // ------------------------------------------------------------------

    function anyFloatWinOpen() {
        for (const id of ['la_viewer_win', 'la_wbman', 'la_compare', 'la_lintwin']) {
            const w = el(id);
            if (w && w.style.display !== 'none') return true;
        }
        return false;
    }

    function mkFlatBtn(label) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'cursor:pointer;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.08);color:inherit;border-radius:6px;padding:7px 11px;font-size:0.82em;';
        return b;
    }
    function mkMiniBtn(label) {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'cursor:pointer;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.08);color:inherit;border-radius:6px;padding:4px 9px;font-size:0.78em;flex:0 0 auto;';
        return b;
    }

    function floatWindow(id, opts) {
        opts = opts || {};
        let backdrop = el(id + '_bd');
        let box = el(id);
        if (!box) {
            backdrop = document.createElement('div');
            backdrop.id = id + '_bd';
            backdrop.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;display:none;background:rgba(0,0,0,0.5);';
            document.body.appendChild(backdrop);

            box = document.createElement('div');
            box.id = id;
            box.style.cssText = 'position:fixed;z-index:9999;display:none;flex-direction:column;border-radius:10px;border:1px solid rgba(255,255,255,0.3);background:#1e1e1e;color:#dddddd;box-shadow:0 8px 30px rgba(0,0,0,0.6);overflow:hidden;';

            const head = document.createElement('div');
            head.id = id + '_head';
            head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.2);flex:0 0 auto;cursor:move;user-select:none;touch-action:none;background:rgba(255,255,255,0.05);flex-wrap:wrap;';
            const title = document.createElement('span');
            title.id = id + '_title';
            title.style.cssText = 'flex:1 1 auto;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:120px;';
            const closeBtn = document.createElement('button');
            closeBtn.textContent = 'Close';
            closeBtn.style.cssText = 'cursor:pointer;border:1px solid rgba(255,255,255,0.35);background:rgba(220,90,90,0.3);color:inherit;border-radius:6px;padding:8px 14px;font-size:0.9em;flex:0 0 auto;';
            const doClose = () => { backdrop.style.display = 'none'; box.style.display = 'none'; };
            closeBtn.addEventListener('click', doClose);
            head.appendChild(title);
            head.appendChild(closeBtn);

            const bodyEl = document.createElement('div');
            bodyEl.id = id + '_body';
            bodyEl.style.cssText = 'flex:1 1 auto;overflow-y:auto;padding:10px;box-sizing:border-box;';

            box.appendChild(head);
            box.appendChild(bodyEl);
            document.body.appendChild(box);

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && box.style.display !== 'none') doClose();
            });
            makeDraggable(box, head);
        }
        // Snap to a safe spot + size every open (Android WebView off-screen lesson).
        box.style.left = opts.left || '2vw';
        box.style.top = opts.top || '54px';
        box.style.right = 'auto';
        box.style.bottom = 'auto';
        box.style.width = opts.width || '96vw';
        box.style.height = opts.height || '80vh';
        el(id + '_title').textContent = String(opts.title || '');
        backdrop.style.display = 'block';
        box.style.display = 'flex';
        return { box, backdrop, body: el(id + '_body'), close: () => { backdrop.style.display = 'none'; box.style.display = 'none'; } };
    }

    // Apply text changes to one or more documents as a single undoable batch,
    // wired into the SAME batch log the main Undo button walks (so promoting an
    // entry across two documents is reverted by one Undo press). Mirrors the
    // commit tail of applyEdits.
    function commitDocChanges(changes, noteLabel) {
        const real = (changes || []).filter(c => c && c.doc && c.after !== c.before);
        if (!real.length) return null;
        const batchId = uid();
        for (const c of real) {
            pushUndo(c.doc, c.before, noteLabel || 'edit', batchId);
            c.doc.text = c.after;
            c.doc.updated = Date.now();
        }
        if (!Array.isArray(settings.batchLog)) settings.batchLog = [];
        settings.batchLog.push(batchId);
        while (settings.batchLog.length > 8) settings.batchLog.shift();
        persist();
        const active = activeDoc();
        if (active) pushHistory(active, 'note', (noteLabel || 'Edited') + ': ' + real.map(c => '"' + c.doc.name + '"').join(', ') + '.');
        for (const c of real) syncOpenDocEditor(c.doc, c.before);
        updateSub();
        renderHistory();
        return batchId;
    }

    // ------------------------------------------------------------------
    // Worldbook manager: per-entry editing, validate/repair, token budget,
    // and promote (move an entry into another document, e.g. the PE).
    // Opened by View on a worldbook document instead of the text preview.
    // ------------------------------------------------------------------

    // Deterministic "Check" window: shows exactly what the raw text contains (double
    // spaces with visible dots, trailing whitespace, JSON validity) so the user never
    // has to rely on the model's unreliable whitespace perception, plus undoable fixes.
    function showDocLint() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'warning'); return; }
        const win = floatWindow('la_lintwin', { title: '\uD83D\uDD0D Check \u2014 ' + doc.name, height: '78vh' });
        const body = win.body;
        body.innerHTML = '';
        const rpt = docLint(doc.text || '');
        const mk = (tag, css, txt) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
        const row = (txt, good) => { const d = mk('div', 'padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08);'); const b = mk('span', 'font-weight:700;color:' + (good ? '#7fce8b' : '#e6a94a') + ';', good ? '\u2713 ' : '\u26A0 '); d.appendChild(b); d.appendChild(document.createTextNode(txt)); return d; };

        body.appendChild(mk('div', 'opacity:0.7;font-size:0.85em;margin-bottom:10px;', 'Deterministic scan of the raw text \u2014 not the model. Spaces are drawn as \u00B7 so you can actually see them.'));

        if (rpt.inlineCount === 0) body.appendChild(row('No inline double-spaces.', true));
        else {
            body.appendChild(row(rpt.inlineCount + ' inline double-space' + (rpt.inlineCount > 1 ? 's' : '') + ':', false));
            const list = mk('div', 'font-family:monospace;font-size:0.82em;margin:4px 0 10px 14px;');
            rpt.inlineDoubleSpaces.forEach(h => list.appendChild(mk('div', 'padding:2px 0;opacity:0.85;', 'line ' + h.line + ':  \u2026' + h.sample + '\u2026')));
            if (rpt.inlineCount > rpt.inlineDoubleSpaces.length) list.appendChild(mk('div', 'opacity:0.6;', '\u2026and ' + (rpt.inlineCount - rpt.inlineDoubleSpaces.length) + ' more.'));
            body.appendChild(list);
        }
        body.appendChild(row(rpt.trailingWs ? rpt.trailingWs + ' line(s) with trailing whitespace.' : 'No trailing whitespace.', rpt.trailingWs === 0));
        if (rpt.tabs) body.appendChild(row(rpt.tabs + ' tab character(s).', false));
        if (rpt.crlf) body.appendChild(row('Windows (CRLF) line endings present.', false));

        if (rpt.jsonLike) {
            if (rpt.jsonValid) body.appendChild(row('Valid JSON.', true));
            else {
                body.appendChild(row('INVALID JSON: ' + rpt.jsonError, false));
                body.appendChild(mk('div', 'opacity:0.75;font-size:0.85em;margin:2px 0 6px 14px;', rpt.jsonFixable ? 'Auto-fixable (escape raw line breaks / drop trailing commas).' : 'Not auto-fixable \u2014 likely an unescaped double-quote inside a value; open View to fix it by hand near the reported position.'));
            }
        } else body.appendChild(mk('div', 'opacity:0.55;font-size:0.85em;padding:6px 0;', 'Not a JSON document \u2014 JSON check skipped.'));

        const btnRow = mk('div', 'display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;');
        const mkBtn = (label, bg, fn) => { const b = mk('button', 'cursor:pointer;border:1px solid rgba(255,255,255,0.3);background:' + bg + ';color:inherit;border-radius:8px;padding:10px 14px;font-size:0.9em;', label); b.addEventListener('click', fn); return b; };
        if (rpt.inlineCount > 0) btnRow.appendChild(mkBtn('Collapse ' + rpt.inlineCount + ' double-space' + (rpt.inlineCount > 1 ? 's' : ''), 'rgba(90,150,220,0.3)', () => {
            const d = activeDoc(); if (!d) return;
            commitDocChanges([{ doc: d, before: d.text, after: collapseInlineSpaces(d.text) }], 'Collapsed inline double-spaces');
            toast('Collapsed double-spaces (undoable).', 'success'); showDocLint();
        }));
        if (rpt.jsonLike && rpt.jsonValid === false && rpt.jsonFixable) btnRow.appendChild(mkBtn('Repair JSON', 'rgba(90,200,120,0.3)', () => {
            const d = activeDoc(); if (!d) return;
            const r = repairDocJson(d.text);
            if (!r.changed) { toast('Could not repair automatically.', 'warning'); return; }
            commitDocChanges([{ doc: d, before: d.text, after: r.text }], 'Repaired JSON format');
            toast('JSON repaired (undoable).', 'success'); showDocLint();
        }));
        btnRow.appendChild(mkBtn('Re-scan', 'rgba(255,255,255,0.12)', () => showDocLint()));
        body.appendChild(btnRow);
    }

    function showWorldbookManager(docId) {
        const doc0 = settings.docs.find(d => d.id === docId) || activeDoc();
        if (!doc0) { toast('No document selected.', 'warning'); return; }
        const win = floatWindow('la_wbman', { title: '\uD83C\uDF10 ' + doc0.name, height: '82vh' });
        win.box._wbDocId = doc0.id;
        wbRenderList(win);
    }

    function wbCurrentDoc(win) {
        return settings.docs.find(d => d.id === win.box._wbDocId) || null;
    }

    function repairWorldbook(doc) {
        const p = parseWorldbook(doc.text);
        if (p.error) { toast('Cannot repair \u2014 JSON too broken to parse: ' + p.error + '. Fix it in raw JSON.', 'error'); return; }
        const clean = serializeWorldbook(p.entries);
        const before = doc.text;
        if (clean.trim() === before.trim()) { toast('Already clean \u2014 nothing to repair.', 'info'); return; }
        commitDocChanges([{ doc, before, after: clean }], 'Repaired worldbook');
        toast('Repaired & normalized ' + p.entries.length + ' entr' + (p.entries.length === 1 ? 'y' : 'ies') + ' (formatting + field types).', 'success');
    }

    function wbPromoteEntry(win, index, targetId) {
        const doc = wbCurrentDoc(win);
        const target = settings.docs.find(d => d.id === targetId);
        if (!doc || !target) { toast('Pick a valid target document.', 'warning'); return; }
        const entries = parseWorldbook(doc.text).entries;
        const e = entries[index];
        if (!e) return;
        if (!confirm('Move "' + (e.name || 'entry') + '" into "' + target.name + '" and remove it from this worldbook?')) return;
        const beforeT = String(target.text || '');
        const section = '## ' + (e.name || 'Untitled') + '\n\n' + (e.content || '');
        const trimmed = beforeT.replace(/\s+$/, '');
        const afterT = trimmed.length ? (trimmed + '\n\n' + section + '\n') : (section + '\n');
        const beforeW = doc.text;
        const afterW = serializeWorldbook(entries.filter((_, i) => i !== index));
        commitDocChanges(
            [{ doc: target, before: beforeT, after: afterT }, { doc, before: beforeW, after: afterW }],
            'Moved worldbook entry \u2192 "' + target.name + '"'
        );
        toast('Moved "' + (e.name || 'entry') + '" into "' + target.name + '".', 'success');
        wbRenderList(win);
    }

    function wbSourcePicker(win) {
        const doc = wbCurrentDoc(win);
        const body = win.body;
        body.innerHTML = '';
        if (!doc) { body.textContent = 'Document no longer exists.'; return; }
        el('la_wbman_title').textContent = '\uD83C\uDF10 ' + doc.name + ' \u00B7 from document';
        const back = mkFlatBtn('\u2190 Back');
        back.addEventListener('click', () => wbRenderList(win));
        body.appendChild(back);
        const h = document.createElement('div');
        h.style.cssText = 'margin:10px 0;font-size:0.85em;opacity:0.8;line-height:1.4;';
        h.textContent = 'Pick a document to turn into a new worldbook entry \u2014 its text becomes the entry content (the source document is not changed):';
        body.appendChild(h);
        const others = settings.docs.filter(d => d.id !== doc.id);
        if (!others.length) {
            const e = document.createElement('div');
            e.style.cssText = 'opacity:0.6;';
            e.textContent = 'No other documents exist yet.';
            body.appendChild(e);
            return;
        }
        for (const d of others) {
            const b = mkFlatBtn('\uD83D\uDCC4 ' + (oneLine(d.name).slice(0, 34) || 'Untitled') + '  \u00B7 ' + (d.text || '').length.toLocaleString() + ' ch');
            b.style.display = 'block';
            b.style.width = '100%';
            b.style.textAlign = 'left';
            b.style.marginBottom = '6px';
            b.addEventListener('click', () => wbRenderEntryForm(win, null, { name: d.name, content: d.text || '' }));
            body.appendChild(b);
        }
    }

    function wbRenderList(win) {
        const doc = wbCurrentDoc(win);
        const body = win.body;
        body.innerHTML = '';
        if (!doc) { body.textContent = 'Document no longer exists.'; return; }
        el('la_wbman_title').textContent = '\uD83C\uDF10 ' + doc.name;
        const p = parseWorldbook(doc.text);
        if (p.error) {
            const err = document.createElement('div');
            err.style.cssText = 'padding:10px 2px;color:#ff9c9c;font-size:0.9em;line-height:1.4;';
            err.textContent = 'This worldbook is not valid JSON: ' + p.error + '. Open raw JSON to fix it, or ask the agent.';
            body.appendChild(err);
            const rawB = mkFlatBtn('{ } Edit raw JSON');
            rawB.addEventListener('click', () => { win.close(); viewDocRaw(doc.id); });
            body.appendChild(rawB);
            return;
        }
        const entries = p.entries;
        const stats = worldbookTokenStats(entries);
        const warns = lintWorldbook(entries);

        const hdr = document.createElement('div');
        hdr.style.cssText = 'font-size:0.82em;opacity:0.82;margin-bottom:8px;line-height:1.5;';
        hdr.textContent = entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies')
            + '  \u00B7  ~' + stats.total.toLocaleString() + ' tokens total'
            + (stats.blueCount ? '  \u00B7  ~' + stats.alwaysOn.toLocaleString() + ' always-on (' + stats.blueCount + ' blue)' : '');
        body.appendChild(hdr);

        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;';
        const addB = mkFlatBtn('\u2795 Add entry');
        addB.addEventListener('click', () => wbRenderEntryForm(win, null));
        const fromB = mkFlatBtn('\u2795 From doc');
        fromB.title = 'Create an entry from another document\u2019s content';
        fromB.addEventListener('click', () => wbSourcePicker(win));
        const repairB = mkFlatBtn('\uD83D\uDD27 Validate & repair');
        repairB.addEventListener('click', () => { repairWorldbook(doc); wbRenderList(win); });
        const expB = mkFlatBtn('\uD83C\uDF10\u2192ST export');
        expB.addEventListener('click', () => exportWorldbookST());
        const rawB = mkFlatBtn('{ } Raw JSON');
        rawB.addEventListener('click', () => { win.close(); viewDocRaw(doc.id); });
        [addB, fromB, repairB, expB, rawB].forEach(b => bar.appendChild(b));
        body.appendChild(bar);

        if (warns.length) {
            const w = document.createElement('div');
            w.style.cssText = 'font-size:0.76em;color:#ffd479;opacity:0.9;margin-bottom:10px;line-height:1.45;';
            w.textContent = '\u26A0 ' + warns.slice(0, 6).join('  \u00B7  ') + (warns.length > 6 ? '  \u00B7 \u2026and ' + (warns.length - 6) + ' more' : '');
            body.appendChild(w);
        }

        if (!entries.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'opacity:0.6;padding:14px 4px;text-align:center;font-size:0.9em;line-height:1.5;';
            empty.textContent = 'No entries yet. Tap "Add entry", pull one "From doc", or ask the agent to add lore.';
            body.appendChild(empty);
            return;
        }

        const icon = { blue: '\uD83D\uDD35', green: '\uD83D\uDFE2', chain: '\uD83D\uDD17' };
        const posLabel = { before_char: '\u2191before', after_char: '\u2193after', at_depth: '@depth' };
        entries.forEach((e, i) => {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid rgba(255,255,255,0.16);border-radius:8px;padding:8px 10px;margin-bottom:8px;background:rgba(255,255,255,0.03);';
            const top = document.createElement('div');
            top.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px;';
            const nm = document.createElement('span');
            nm.textContent = (icon[e.strategy] || '\u2022') + ' ' + (e.name || '(unnamed)');
            nm.style.cssText = 'font-weight:600;flex:1 1 auto;min-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            const editB = mkMiniBtn('\u270E Edit');
            editB.addEventListener('click', () => wbRenderEntryForm(win, i));
            const delB = mkMiniBtn('\uD83D\uDDD1');
            delB.title = 'Delete entry';
            delB.addEventListener('click', () => {
                if (!confirm('Delete "' + (e.name || '') + '"?')) return;
                const before = doc.text;
                const after = serializeWorldbook(entries.filter((_, x) => x !== i));
                commitDocChanges([{ doc, before, after }], 'Deleted worldbook entry');
                wbRenderList(win);
            });
            top.appendChild(nm);
            top.appendChild(editB);
            top.appendChild(delB);
            card.appendChild(top);

            const meta = document.createElement('div');
            meta.style.cssText = 'font-size:0.75em;opacity:0.65;margin-bottom:4px;';
            meta.textContent = e.strategy + ' \u00B7 ' + (posLabel[e.position] || e.position)
                + (e.position === 'at_depth' ? (' ' + e.depth) : '') + ' \u00B7 order ' + e.order
                + (e.probability !== 100 ? (' \u00B7 ' + e.probability + '%') : '') + ' \u00B7 ~' + estTokens(e.content) + ' tok';
            card.appendChild(meta);

            if (e.keys.length || e.strategy === 'green') {
                const keys = document.createElement('div');
                keys.style.cssText = 'font-size:0.75em;opacity:0.7;margin-bottom:4px;word-break:break-word;';
                keys.textContent = 'keys: ' + (e.keys.length ? e.keys.join(', ') : '(none \u2014 will not fire!)');
                card.appendChild(keys);
            }
            const prev = document.createElement('div');
            prev.style.cssText = 'font-size:0.8em;opacity:0.85;white-space:pre-wrap;word-break:break-word;max-height:80px;overflow:hidden;';
            prev.textContent = e.content || '(empty content)';
            card.appendChild(prev);
            body.appendChild(card);
        });
    }

    function wbRenderEntryForm(win, index, seed) {
        const doc = wbCurrentDoc(win);
        const body = win.body;
        body.innerHTML = '';
        if (!doc) { body.textContent = 'Document no longer exists.'; return; }
        const entries = parseWorldbook(doc.text).entries;
        const isNew = index == null;
        const e = isNew
            ? { name: (seed && seed.name) || '', keys: [], content: (seed && seed.content) || '', strategy: 'green', order: 100, position: 'after_char', depth: 4, probability: 100, comment: '' }
            : entries[index];
        if (!e) { wbRenderList(win); return; }
        el('la_wbman_title').textContent = '\uD83C\uDF10 ' + doc.name + ' \u00B7 ' + (isNew ? 'new entry' : 'edit entry');

        const inputStyle = 'width:100%;box-sizing:border-box;background:rgba(0,0,0,0.3);color:inherit;border:1px solid rgba(255,255,255,0.25);border-radius:6px;padding:8px;font-size:0.9em;';
        const field = (labelText, control, hintText) => {
            const w = document.createElement('div');
            w.style.cssText = 'margin-bottom:10px;';
            const l = document.createElement('label');
            l.textContent = labelText;
            l.style.cssText = 'display:block;font-size:0.8em;opacity:0.85;margin-bottom:3px;';
            w.appendChild(l);
            w.appendChild(control);
            if (hintText) {
                const hh = document.createElement('div');
                hh.textContent = hintText;
                hh.style.cssText = 'font-size:0.72em;opacity:0.5;margin-top:2px;line-height:1.35;';
                w.appendChild(hh);
            }
            return w;
        };

        const nameIn = document.createElement('input'); nameIn.type = 'text'; nameIn.value = e.name || ''; nameIn.style.cssText = inputStyle;
        const stratSel = document.createElement('select'); stratSel.style.cssText = inputStyle;
        [['green', '\uD83D\uDFE2 green \u2014 fires on keywords (default)'], ['blue', '\uD83D\uDD35 blue \u2014 always in context (spine only)'], ['chain', '\uD83D\uDD17 chain \u2014 semantic/vector only']]
            .forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; stratSel.appendChild(o); });
        stratSel.value = e.strategy || 'green';
        const keysIn = document.createElement('input'); keysIn.type = 'text'; keysIn.value = (e.keys || []).join(', '); keysIn.style.cssText = inputStyle;
        const posSel = document.createElement('select'); posSel.style.cssText = inputStyle;
        [['after_char', '\u2193 after char defs (default)'], ['before_char', '\u2191 before char defs (world/setting)'], ['at_depth', '@ at depth (live/salient)']]
            .forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; posSel.appendChild(o); });
        posSel.value = e.position || 'after_char';
        const orderIn = document.createElement('input'); orderIn.type = 'number'; orderIn.value = e.order; orderIn.style.cssText = inputStyle;
        const probIn = document.createElement('input'); probIn.type = 'number'; probIn.min = '0'; probIn.max = '100'; probIn.value = e.probability; probIn.style.cssText = inputStyle;
        const depthIn = document.createElement('input'); depthIn.type = 'number'; depthIn.min = '0'; depthIn.value = e.depth; depthIn.style.cssText = inputStyle;
        const contentTa = document.createElement('textarea'); contentTa.value = e.content || ''; contentTa.style.cssText = inputStyle + 'min-height:140px;resize:vertical;font-family:monospace;line-height:1.4;';
        const commentIn = document.createElement('input'); commentIn.type = 'text'; commentIn.value = e.comment || ''; commentIn.style.cssText = inputStyle;

        body.appendChild(field('Name (unique title)', nameIn));
        body.appendChild(field('Strategy', stratSel));
        body.appendChild(field('Keys (comma-separated)', keysIn, 'Proper name, aliases, epithets, titles, and the everyday words a scene would use.'));
        body.appendChild(field('Position', posSel));
        const numRow = document.createElement('div'); numRow.style.cssText = 'display:flex;gap:8px;';
        const ow = field('Order (higher wins budget)', orderIn); ow.style.flex = '1 1 0';
        const pw = field('Probability %', probIn); pw.style.flex = '1 1 0';
        numRow.appendChild(ow); numRow.appendChild(pw);
        body.appendChild(numRow);
        const depthField = field('Depth (higher = further from latest message)', depthIn);
        body.appendChild(depthField);
        const syncDepth = () => { depthField.style.display = posSel.value === 'at_depth' ? 'block' : 'none'; };
        posSel.addEventListener('change', syncDepth); syncDepth();
        body.appendChild(field('Content (the lore text injected at runtime)', contentTa));
        body.appendChild(field('Comment (optional author note)', commentIn));

        const readForm = () => ({
            name: nameIn.value.trim() || '(unnamed)',
            keys: keysIn.value.split(',').map(k => k.trim()).filter(Boolean),
            content: contentTa.value,
            strategy: stratSel.value,
            order: numOr(orderIn.value, 100),
            position: posSel.value,
            depth: Math.max(0, Math.round(numOr(depthIn.value, 4))),
            probability: Math.max(0, Math.min(100, numOr(probIn.value, 100))),
            comment: commentIn.value.trim(),
        });

        const others = settings.docs.filter(d => d.id !== doc.id);
        if (!isNew && others.length) {
            const moveWrap = document.createElement('div');
            moveWrap.style.cssText = 'margin-top:14px;padding-top:10px;border-top:1px dashed rgba(255,255,255,0.2);';
            const ml = document.createElement('div');
            ml.textContent = 'Move this entry into another document (appends its content there, removes it here \u2014 one Undo reverts both):';
            ml.style.cssText = 'font-size:0.78em;opacity:0.7;margin-bottom:6px;line-height:1.4;';
            const mrow = document.createElement('div'); mrow.style.cssText = 'display:flex;gap:8px;';
            const tsel = document.createElement('select'); tsel.style.cssText = inputStyle + 'flex:1 1 auto;';
            for (const d of others) { const o = document.createElement('option'); o.value = d.id; o.textContent = oneLine(d.name).slice(0, 30); tsel.appendChild(o); }
            const mbtn = mkFlatBtn('Move \u2192'); mbtn.style.flex = '0 0 auto';
            mbtn.addEventListener('click', () => wbPromoteEntry(win, index, tsel.value));
            mrow.appendChild(tsel); mrow.appendChild(mbtn);
            moveWrap.appendChild(ml); moveWrap.appendChild(mrow);
            body.appendChild(moveWrap);
        }

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;position:sticky;bottom:-10px;background:#1e1e1e;padding:8px 0;';
        const mkBtn = (label, bg) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'cursor:pointer;border:1px solid rgba(255,255,255,0.3);background:' + bg + ';color:inherit;border-radius:6px;padding:9px 14px;font-size:0.9em;'; return b; };
        const saveBtn = mkBtn(isNew ? 'Add entry' : 'Save entry', 'rgba(80,200,120,0.32)'); saveBtn.style.fontWeight = '700';
        const backBtn = mkBtn('\u2190 Back', 'rgba(255,255,255,0.1)');
        saveBtn.addEventListener('click', () => {
            const ne = readForm();
            const next = isNew ? entries.concat([ne]) : entries.map((x, i) => i === index ? ne : x);
            const before = doc.text;
            const after = serializeWorldbook(next);
            commitDocChanges([{ doc, before, after }], isNew ? 'Added worldbook entry' : 'Edited worldbook entry');
            toast((isNew ? 'Added "' : 'Saved "') + ne.name + '".', 'success');
            wbRenderList(win);
        });
        backBtn.addEventListener('click', () => wbRenderList(win));
        btnRow.appendChild(saveBtn);
        btnRow.appendChild(backBtn);
        if (!isNew) {
            const delBtn = mkBtn('\uD83D\uDDD1 Delete', 'rgba(220,80,80,0.28)');
            delBtn.addEventListener('click', () => {
                if (!confirm('Delete entry "' + (e.name || '') + '" from the worldbook?')) return;
                const before = doc.text;
                const after = serializeWorldbook(entries.filter((_, i) => i !== index));
                commitDocChanges([{ doc, before, after }], 'Deleted worldbook entry');
                toast('Deleted "' + (e.name || 'entry') + '".', 'info');
                wbRenderList(win);
            });
            btnRow.appendChild(delBtn);
        }
        body.appendChild(btnRow);
    }

    // ------------------------------------------------------------------
    // Compare view: 2\u20134 documents side by side (columns) or stacked, with a
    // layout toggle. Read-only, for drawing inspiration across drafts.
    // ------------------------------------------------------------------

    function showContextBreakdown() {
        const doc = activeDoc();
        if (!doc) { toast('No document selected.', 'info'); return; }
        const b = contextTokenBreakdown(doc);
        const refPart = b.refs.length
            ? '~' + kFmt(b.refsTotal) + ' (' + b.refs.map(r => oneLine(r.name).slice(0, 14) + ' ' + kFmt(r.tokens)).join(', ') + ')'
            : 'none';
        toast('Next-message context \u2248 ' + b.total.toLocaleString() + ' tok'
            + '  \u00B7  system+protocol ~' + kFmt(b.system)
            + '  \u00B7  document ~' + kFmt(b.doc)
            + '  \u00B7  refs ' + refPart
            + '  \u00B7  history ~' + kFmt(b.history) + ' (' + b.turns + ' turn' + (b.turns === 1 ? '' : 's') + (b.notes ? ' +' + b.notes + ' note' + (b.notes === 1 ? '' : 's') : '') + ')',
            'info');
    }

    function showCompare() {
        if (!settings.docs.length) { toast('No documents to compare yet.', 'warning'); return; }
        const win = floatWindow('la_compare', { title: '\u2696 Compare documents', height: '82vh' });
        renderCompareBody(win);
    }

    function renderCompareBody(win) {
        const body = win.body;
        body.innerHTML = '';

        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px;';
        const layoutBtn = document.createElement('button');
        layoutBtn.style.cssText = 'cursor:pointer;border:1px solid rgba(255,255,255,0.35);background:rgba(255,255,255,0.12);color:inherit;border-radius:6px;padding:7px 12px;font-size:0.85em;';
        layoutBtn.title = 'Toggle side-by-side columns vs stacked rows';
        const setLayoutLabel = () => { layoutBtn.textContent = settings.compareLayout === 'stacked' ? '\u2637 Stacked' : '\u2016 Columns'; };
        setLayoutLabel();
        layoutBtn.addEventListener('click', () => {
            settings.compareLayout = settings.compareLayout === 'stacked' ? 'columns' : 'stacked';
            persist();
            renderCompareBody(win);
        });
        controls.appendChild(layoutBtn);
        const hint = document.createElement('span');
        hint.style.cssText = 'font-size:0.75em;opacity:0.6;';
        hint.textContent = 'Pick 2\u20134 documents to compare';
        controls.appendChild(hint);
        body.appendChild(controls);

        const chips = document.createElement('div');
        chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;';
        const liveSel = () => (settings.compareIds || []).filter(id => settings.docs.some(d => d.id === id));
        for (const d of settings.docs) {
            const on = liveSel().includes(d.id);
            const chip = document.createElement('button');
            chip.textContent = (on ? '\u2611 ' : '\u2610 ') + (oneLine(d.name).slice(0, 24) || 'Untitled');
            chip.style.cssText = 'cursor:pointer;border:1px solid rgba(255,255,255,0.3);background:' + (on ? 'rgba(80,160,240,0.3)' : 'rgba(255,255,255,0.06)') + ';color:inherit;border-radius:14px;padding:6px 11px;font-size:0.82em;';
            chip.addEventListener('click', () => {
                let cur = liveSel();
                if (cur.includes(d.id)) cur = cur.filter(x => x !== d.id);
                else {
                    if (cur.length >= 4) { toast('Compare up to 4 documents at once.', 'warning'); return; }
                    cur = cur.concat([d.id]);
                }
                settings.compareIds = cur;
                persist();
                renderCompareBody(win);
            });
            chips.appendChild(chip);
        }
        body.appendChild(chips);

        const explain = document.createElement('div');
        explain.style.cssText = 'font-size:0.74em;opacity:0.6;margin:-2px 0 10px;line-height:1.45;';
        explain.textContent = 'This is a read-only view for you \u2014 it does NOT feed anything to the agent. To let the agent read a document while it works, tap \uD83D\uDD17 on its pane below (or the \uD83D\uDD17 button in the panel).';
        body.appendChild(explain);

        const selected = liveSel();
        if (selected.length < 2) {
            const note = document.createElement('div');
            note.style.cssText = 'opacity:0.6;font-size:0.9em;padding:20px 4px;text-align:center;line-height:1.5;';
            note.textContent = 'Select at least 2 documents above to compare them.';
            body.appendChild(note);
            return;
        }

        const docs = selected.map(id => settings.docs.find(d => d.id === id)).filter(Boolean);
        const active = activeDoc();
        const stacked = settings.compareLayout === 'stacked';
        const area = document.createElement('div');
        area.style.cssText = stacked
            ? 'display:flex;flex-direction:column;gap:10px;'
            : 'display:flex;flex-direction:row;gap:10px;overflow-x:auto;padding-bottom:6px;';
        for (const d of docs) {
            const pane = document.createElement('div');
            pane.style.cssText = stacked
                ? 'border:1px solid rgba(255,255,255,0.18);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;max-height:46vh;'
                : 'flex:0 0 auto;width:82vw;max-width:520px;border:1px solid rgba(255,255,255,0.18);border-radius:8px;overflow:hidden;display:flex;flex-direction:column;max-height:62vh;';
            const ph = document.createElement('div');
            ph.style.cssText = 'flex:0 0 auto;padding:6px 9px;background:rgba(255,255,255,0.06);font-weight:600;font-size:0.85em;display:flex;gap:8px;align-items:center;border-bottom:1px solid rgba(255,255,255,0.14);';
            const pname = document.createElement('span');
            pname.style.cssText = 'flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            pname.textContent = d.name;
            const pmeta = document.createElement('span');
            pmeta.style.cssText = 'flex:0 0 auto;opacity:0.6;font-size:0.85em;font-weight:400;';
            pmeta.textContent = (d.text || '').length.toLocaleString() + ' ch';
            ph.appendChild(pname);
            ph.appendChild(pmeta);

            // Bridge to the agent: attach this doc as a reference of the active doc.
            if (active && d.id === active.id) {
                const badge = document.createElement('span');
                badge.textContent = '\u270E active';
                badge.title = 'This is the document the agent is editing';
                badge.style.cssText = 'flex:0 0 auto;font-size:0.7em;opacity:0.5;';
                ph.appendChild(badge);
            } else if (active) {
                const isRef = Array.isArray(active.refs) && active.refs.includes(d.id);
                const attB = document.createElement('button');
                attB.textContent = isRef ? '\uD83D\uDD17 attached' : '\uD83D\uDD17 attach';
                attB.title = isRef
                    ? 'The agent can read this (reference of "' + active.name + '"). Tap to detach.'
                    : 'Let the agent read this while working on "' + active.name + '"';
                attB.style.cssText = 'cursor:pointer;border:1px solid rgba(255,255,255,0.3);background:' + (isRef ? 'rgba(80,160,240,0.32)' : 'rgba(255,255,255,0.08)') + ';color:inherit;border-radius:5px;padding:3px 8px;font-size:0.72em;flex:0 0 auto;white-space:nowrap;';
                attB.addEventListener('click', () => {
                    if (!Array.isArray(active.refs)) active.refs = [];
                    const nowOn = !active.refs.includes(d.id);
                    if (nowOn) active.refs.push(d.id);
                    else active.refs = active.refs.filter(x => x !== d.id);
                    persist();
                    updateRefCount();
                    updateSub();
                    const rb = el('la_refbar');
                    if (rb && rb.style.display !== 'none') renderRefBar();
                    renderCompareBody(win);
                    toast(nowOn ? 'Attached "' + d.name + '" \u2014 the agent can now read it while working on "' + active.name + '".' : 'Detached "' + d.name + '".', 'success');
                });
                ph.appendChild(attB);
            }

            const copyB = document.createElement('button');
            copyB.textContent = '\uD83D\uDCCB';
            copyB.title = 'Copy this document';
            copyB.style.cssText = 'cursor:pointer;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.08);color:inherit;border-radius:5px;padding:3px 7px;font-size:0.9em;flex:0 0 auto;';
            copyB.addEventListener('click', async () => { const ok = await copyText(d.text || ''); toast(ok ? 'Copied "' + d.name + '".' : 'Copy failed.', ok ? 'success' : 'error'); });
            ph.appendChild(copyB);

            const pbody = document.createElement('div');
            pbody.style.cssText = 'flex:1 1 auto;overflow-y:auto;padding:9px 10px;white-space:pre-wrap;word-break:break-word;font-family:monospace;font-size:0.8em;line-height:1.45;';
            pbody.textContent = d.text || '(empty)';
            pane.appendChild(ph); pane.appendChild(pbody);
            area.appendChild(pane);
        }
        body.appendChild(area);
    }

    // Engine internals exposed for automated testing (harmless in production).
    try {
        globalThis.__loreAgentDebug = {
            VERSION, findBlock, parseDocEdits, stripBlocks, splitThinking,
            normChars, levenshtein, locate, applyEditToText, grow, mimeForName, resolveDocByName,
            ensureDocShape, sess, parseWorldbook, lintWorldbook, worldbookToST, docLooksLikeWorldbook,
            normalizePosition, positionToST,
            numOr, estTokens, worldbookTokenStats, serializeWorldbook, pickContextWindow, contextTokenBreakdown,
            parseSupersede, formatPendingProposals,
            docLint, collapseInlineSpaces, repairDocJson,
            getSettings: () => settings,
            getPendingEdits: () => pendingEdits,
        };
    } catch (e) { /* ignore */ }
})();
