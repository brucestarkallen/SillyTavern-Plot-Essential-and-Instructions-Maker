# AGENTS.md — maintainer brief for AI-assisted development

You (an AI model) are continuing development of **Lore Agent**, a SillyTavern third-party extension built iteratively with the repo owner, who tests on **SillyTavern under Termux/Android, accessed from a mobile browser**. Read this whole file before changing anything. Its sibling project (same author, same patterns) is Continuity Copilot.

## What this extension is

A floating chat panel where the user talks to an LLM about a plain-text/markdown document, and the LLM edits the document via a strict protocol — one `<docedits>` JSON block per reply (find/replace, insert_after, append, replace_all, optional `"doc"` to target an attached reference document). Edits render as red/green diff cards the user approves; applies are undoable. Documents, presets, sessions, and undo stacks all live in `SillyTavern.getContext().extensionSettings.loreAgent` — **never** in chat or chatMetadata; the extension must work with no character/chat loaded.

## Architecture map (index.js, one IIFE, no imports)

1. Constants: `VERSION`, seeded presets, `DOCEDITS_PROTOCOL` (appended to every preset **in code** — never store it inside presets).
2. Helpers: `esc`, `uid`, `toast`, `copyText` (clipboard + execCommand fallback for http/LAN), `downloadText`/`mimeForName`.
3. Settings/data: `loadSettings` (merges defaults, seeds presets, migrates doc shapes), `ensureDocShape`, docs/presets/sessions accessors (`sess(doc)` = active session), `pushHistory` (80-entry cap/session), `pushUndo` (8 backups/doc, batch-tagged), `resolveDocByName`, `refsOf`.
4. Parsing: `findBlock` (LAST opening tag with a closer, prefer JSON-looking inner — prose mentions of the tag must never poison it), `parseDocEdits` (fence-strip, trailing-comma repair, per-edit `docName`), `stripBlocks` (same span logic for display), `splitThinking` (closed + unclosed think tags).
5. Edit engine: `normChars` (1:1 length-preserving), `levenshtein` (works on word arrays), `locate` (exact → normalized → fuzzy word-window ±15%, sim ≥ 0.78, 3–150 words, **alignment-vote prefilter** so 30k+ char docs stay fast), `applyEditToText`, `applyEdits` (multi-doc batches), `undoLast` (batch-aware via `settings.batchLog`, per-doc fallback).
6. LLM: `callLLM` via `ConnectionManagerRequestService.sendRequest(profileId, messages, maxTokens, {stream, signal})`; streaming returns a generator — accumulate with `acc = t.startsWith(acc) ? t : acc + t` (chunks may be cumulative or delta); reasoning arrives via `chunk.state?.reasoning`. Fallback `generateRaw({prompt, systemPrompt})`. Stop = AbortController + `ctx.stopGeneration?.()`, keep partial text.
7. Prompt assembly: `buildMessages` = system (preset + protocol) → recent session history (`historyDepth`) → the **full document(s)** injected into the LAST user message (`[REFERENCE DOCUMENT: name]` blocks first, `[DOCUMENT: name]` last; recency improves verbatim copying). Documents are sent whole, never truncated.
8. Conversation ops: `send`, `runGeneration` (guards doc AND session switching mid-generation; always re-syncs `pendingEdits` to the visible reply), swipes on the last assistant message, `retryLast`, edit-and-continue, per-message delete, sessions + `branchAt(idx)`.
9. UI: panel (stylesheet-based, ST theme vars), `showEditor` floating window and the generic `floatWindow(id, opts)` shell used by the worldbook manager + compare view (**all floating overlays 100% inline-styled — never move their styles to CSS**; each `floatWindow` id gets one Esc-to-close listener on first creation; `anyFloatWinOpen()` gates the fullscreen Esc handler), `makeDraggable` (window-level pointer listeners — `setPointerCapture` is unreliable on Android WebView; drag zones: header, doc/session/ref bar, quick row), diff cards, wand-menu entry, `/lore` slash command, `init` with APP_READY + 3s fallback (guarded by `typeof document` so the node load test can't crash).

## Worldbooks (v0.8.0)

A worldbook is an ordinary document holding a JSON array of entry objects (`{name, keys[], content, strategy, order, comment}`), assigned to the seeded **Worldbook Maker** preset (`PRESET_WB_ID`). Its prompt (`WORLDBOOK_MAKER_PROMPT`) is a full working default, not a placeholder. The engine is pure and test-covered:
- `parseWorldbook(text)` — tolerant parse; accepts a top-level array, `{entries:[...]}`, or ST's `{entries:{"0":{...}}}` object-map; infers strategy from ST fields (`constant`→blue, bare `vectorized`→chain). Never throws. Numeric fields (`order`/`depth`/`probability`) are coerced via `numOr` so string-typed numbers (`"300"`) survive instead of silently resetting to defaults (v0.11.0 fix — `Number.isFinite` on a raw string is false).
- `serializeWorldbook(entries)` — inverse of `parseWorldbook` for the fields that matter: canonical JSON, required fields always emitted, optional fields only when non-default. Idempotent and round-trip-safe. Backbone of per-entry editing and Validate & repair.
- `estTokens(s)` / `worldbookTokenStats(entries)` — rough (~chars/4) token estimate; `total`, per-entry, and the always-on **blue** subtotal (the cost paid every message).
- `lintWorldbook(entries)` — non-blocking author warnings (green-without-keys, empty content, duplicate names).
- `worldbookToST(entries)` — emits ST World Info schema. Mapping: blue→`constant:true`; green→keyed + `selective:true` + `vectorized:true` (fires on keywords AND semantically when the user has vectors); chain→`vectorized:true`, no keys. Round-trips back through `parseWorldbook`.
- Per-entry fields (v0.9.0): entries also carry `order`, `position` (friendly `before_char`/`after_char`/`at_depth`), `depth`, `probability`. `normalizePosition`/`positionToST` convert to/from ST's numeric codes (0/1/4). The Worldbook Maker prompt teaches the model to choose each field from the entry's role (spine→before_char+high order, dossiers→after_char, live lore→at_depth; sets share an order). Exporter sets `useProbability` only when probability≠100 and `depth` only for at_depth. All round-trip through `parseWorldbook`.
- `docLooksLikeWorldbook(doc)` — true if WB preset or content parses as entries. Drives the 🌐→ST export button visibility and whether **View** opens the worldbook manager vs the plain text editor.
UI: **+WB** creates one (`[]` + WB preset); **View** on a worldbook opens the **worldbook manager** (`showWorldbookManager` → `wbRenderList`/`wbRenderEntryForm`, a `floatWindow`): per-entry card list with a real edit form (no hand-editing JSON), token-budget header, **Validate & repair** (`repairWorldbook`), Add/Delete, **From doc** import (`wbSourcePicker`), **Move →** promote an entry into another document (`wbPromoteEntry`, undoable across both docs via `commitDocChanges`), and a raw-JSON escape (`viewDocRaw`); **🌐→ST** exports (`exportWorldbookST`). PE↔worldbook interaction is via the existing 🔗 reference system + per-edit `"doc"` targeting + the manager's Move/From-doc actions — no separate sync layer. Keep keywords as the deterministic floor; vectors are always an additive bonus, never a single point of failure.

### Compare view (v0.11.0)
**⚖ Cmp** (`showCompare` → `renderCompareBody`, a `floatWindow`) shows 2–4 documents side by side, read-only, for cross-referencing drafts. Layout toggle: **columns** (horizontal scroll, 82vw panes for mobile swipe) vs **stacked** (vertical). Selection (`settings.compareIds`, capped at 4) and `settings.compareLayout` persist. Per-pane copy.

### Cross-document undo (v0.11.0)
`commitDocChanges(changes, label)` applies text changes to N docs as one batch, pushed to the same `settings.batchLog` the main **Undo** walks — so a promote (append to target + remove from worldbook) reverts in a single Undo. Mirrors the commit tail of `applyEdits`.

## Invariants — do not break these

- Third-party extension boilerplate: `manifest.json` + single-IIFE `index.js` using only `SillyTavern.getContext()`.
- Bump `VERSION` **and** manifest version on every change; version shows in the panel header, editor title, and console — it is the only proof against mobile browser caching. Tell the user to hard-refresh after updates.
- Overlays/floating editors: inline styles + explicit `position:fixed` geometry, reset on every open. No flex-centering with vh-sized boxes.
- Escape everything rendered via innerHTML; prefer `textContent`/createElement.
- One `running` flag gates every generation path; `finally` restores UI; Send morphs into a red Stop.
- Smart scrolling: only auto-scroll if the user was within ~60px of the bottom, measured BEFORE mutating.
- Parse errors in docedits = harmless note, never a crash or partial apply.
- No length caps on presets or documents anywhere.
- Native browser widgets are suspect on this device: `<details>` failed to expand and `setPointerCapture` failed silently — always use explicit JS toggles/handlers with inline styles.

## Iteration protocol

- Before shipping: `node --check index.js` **and** `node test.js` (stubs `SillyTavern`, proves clean load including the 3s timer, runs the engine unit suite). Add tests for any new pure logic via the `globalThis.__loreAgentDebug` export.
- User reports bugs with screenshots; respond with **targeted patches, not rewrites**; update the README changelog every version.
- Data migrations (doc/session shape changes) must be lossless and test-covered — the user has real long-running data in extensionSettings.
- Owner's style: act and build immediately, terse communication, fix root causes, full automation with graceful degradation.
