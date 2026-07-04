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
9. UI: panel (stylesheet-based, ST theme vars), `showEditor` floating window (**100% inline-styled — never move its styles to CSS**), `makeDraggable` (window-level pointer listeners — `setPointerCapture` is unreliable on Android WebView; drag zones: header, doc/session/ref bar, quick row), diff cards, wand-menu entry, `/lore` slash command, `init` with APP_READY + 3s fallback (guarded by `typeof document` so the node load test can't crash).

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
