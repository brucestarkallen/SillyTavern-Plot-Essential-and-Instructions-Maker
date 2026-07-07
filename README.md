# Plot Essential and Instructions Maker (SillyTavern extension)

> A floating AI editor for the two kinds of authored text a SillyTavern story runs on: **Plot Essential** documents (canon / world / character rules) and **AI instruction sets** (system prompts, engine files). You chat with an agent; it edits the document for you — surgically, reviewably, undoably.

A floating chat panel where you talk to an AI agent about a markdown/text document, and the agent **edits the document directly** — surgical find/replace, insertions after an anchor, appends — shown as red/green diff cards you approve, with one-click Undo. Like a code-editing agent, but for lore and prompt documents.

Built for two document-authoring jobs (same editing engine, different agent brains via presets):

1. **Plot Essential (PE) documents** — world rules, magic systems, character dossiers, timelines, authored *before* a story exists.
2. **AI instruction sets** — system prompts, engine files, planner briefs.

It also has a first-class **worldbook** mode (a visual editor for SillyTavern World Info / lorebooks that exports straight to ST's schema), multi-document **references** the agent reads in full, a side-by-side **Compare** view, per-document conversation **sessions** for branching, and a live **context meter** in the header showing how many tokens your next message will send.

Documents are **global and chat-independent**: they live in extension settings, need no character or chat loaded, and survive across everything. The extension never touches the chat, chat metadata, or chat events.

**What it is / isn't.** This is an original, from-scratch extension — *not* a fork of another project. The difference from vanilla SillyTavern: instead of hand-editing lorebooks and prompt files in raw text fields, you get a conversational agent that makes surgical, reviewable, undoable edits; treats your PE / instruction / worldbook files as first-class versioned documents (with references, compare, sessions, undo, and a token meter); and exports worldbooks directly to ST's World Info format. Sibling of Continuity Copilot — same engineering patterns, same author.

**For AI assistants / future maintainers.** Read `AGENTS.md` before changing anything. The user-facing name ("Plot Essential and Instructions Maker") is **not** the internal id: internally the module is **`loreAgent`** — the `extensionSettings` storage key, the console `[LoreAgent]` prefix, and the `globalThis.__loreAgentDebug` export. **Never rename the internal id** — it is the key every saved document and preset lives under, and renaming it orphans all real user data. The rename to the current display name touched display strings only.

## Install

Option A — extension installer (recommended):
1. Put this folder in a GitHub repo with `manifest.json` at the repo root.
2. SillyTavern → Extensions (stacked blocks icon) → **Install extension** → paste the repo URL.

Option B — manual:
1. Copy this extension's folder into `SillyTavern/data/<your-user>/extensions/` (or `public/scripts/extensions/third-party/` on older layouts).
2. Restart SillyTavern / reload the page.

**After every update: hard-refresh or clear cached images.** Mobile browsers cache extension files aggressively; the version stamp in the panel header (and in the editor window title, and in the console `[LoreAgent] ready v…` line) is the only proof of which code is actually running. If the header version doesn't match the manifest you installed, you are running a cached copy.

## Setup

1. Wand menu (Extensions menu next to the chat input) → **Plot Essential and Instructions Maker**. Or type `/lore`.
2. Gear icon → pick a **Connection Profile** (recommended; streaming needs one). "Current API" raw generation works as a fallback but cannot stream.
3. Press **+ New** (or **Imp** to paste an existing file), and talk.

`/lore some request` opens the panel and sends the request in one step.

## The document bar

- **Document dropdown** — switch between documents; each has its own conversation, preset, and undo stack.
- **Preset dropdown (🧠)** — which agent brain this document uses. Remembered per document; switching is instant and applies from the next message.
- **+ New / Ren / Dup / Del** — Dup copies text + preset with a fresh conversation.
- **Imp** — opens an editor window: press **File** to pick a text file from your device (`.md`, `.txt`, `.json`, `.yaml`, anything text — the filename becomes the document name), or Paste/type, then Create. Documents are stored as raw text, so any text-based format works; if the agent should *respect* a format ("keep this valid YAML"), say so in the preset.
- **Exp** — asks for a filename, so you choose the extension (`.md`, `.json`, `.yaml`, `.txt`, …); a document named with an extension suggests it automatically. **📋** copies the whole document (with an `execCommand` fallback, so it works on http/LAN setups where the clipboard API is blocked).
- **View** — the document full-screen in a draggable window: monospace textarea + Save for manual editing anytime, plus File/Copy/Paste (File replaces the window contents from a device file). Manual saves also go on the Undo stack.

## How editing works

Every request sends the agent: its preset prompt + the docedits protocol (appended automatically in code), the **full current document** labeled `[DOCUMENT: name]` (sent whole, never truncated), the recent conversation, and your message. The agent replies with prose plus at most one block:

```
<docedits>
[
  {"find": "verbatim excerpt from the document", "replace": "new text", "reason": "why"},
  {"insert_after": "verbatim anchor line", "replace": "new paragraph placed under the anchor line", "reason": "why"},
  {"append": true, "replace": "text added at the end", "reason": "why"},
  {"replace_all": true, "replace": "entire new document", "reason": "only on an explicit full-rewrite request"},
  {"doc": "reference doc name", "find": "…", "replace": "…", "reason": "optional doc field targets an attached reference"}
]
</docedits>
```

The block becomes diff cards (red = find/anchor, green = replacement) with **Apply / Skip / Apply all / Dismiss** and a Hide/Show collapse. Proposals are a **stable staging area**, not a transient popup: you can reply to discuss them and the cards stay put. A chat-only answer (no edits) leaves your staged cards untouched; a refined proposal is **stacked below** the earlier one under a ▼ divider so you can compare and Apply whichever you prefer (**Apply newest** appears when more than one batch is pending). Only swiping the *same* reply (‹ ›) replaces that reply's cards, since a swipe is an alternate version of one answer rather than a new idea. Applying tries, in order:

1. exact substring match (ambiguous matches are applied at the first occurrence and flagged "1 of N");
2. length-preserving normalization (curly quotes → straight, en/em dashes → `-`, NBSP → space);
3. a fuzzy word-window Levenshtein fallback (±15% widths, 78% similarity, finds of 3–150 words) for when the model slightly misquoted — marked "(fuzzy NN%)" in the card status.

Before each applied batch the whole document is backed up onto that document's **Undo** stack (last 8 kept). A bad or unparseable JSON block becomes a harmless note ("ask the agent to resend valid JSON") — never a crash, never a partial apply.

## Conversation controls

- **Streaming** replies with a live, collapsible **thinking** section (`<think>`-style blocks and backend reasoning are shown while generating, then folded; they are excluded from saved history and can never break edit parsing).
- **Send morphs into a red Stop** while running; stopping keeps the partial text with a note.
- **Retry** regenerates the last agent reply as a swipe — navigate with **‹ n/m ›** under it; **›** past the end generates a new alternative. Each swipe re-renders its own edit cards.
- **✎** on your messages: edit and continue from there (later turns are removed). **📋** copy, **✕** delete per message. **Del last** removes the last exchange, **Clear** wipes the conversation (document untouched).
- Conversation history is stored per document, capped at 80 entries; the "History depth" setting controls how many recent messages are actually sent per request (default 16 — the full document is always sent regardless).

## Worldbooks (the lore beyond the Plot Essential)

This extension can build a **SillyTavern worldbook** — the large encyclopedia of world lore that lives *outside* the Plot Essential. The PE is your always-loaded spine; the worldbook is everything that should load only when relevant (NPCs the story hasn't reached, locations, factions, history, items), so it never bloats your token budget.

**Create one:** press **+WB** in the management bar (the ⋮ fold-out). You get a JSON document assigned to the **Worldbook Maker** preset. Attach your Plot Essential via 🔗 so every entry stays consistent with the spine and doesn't duplicate it, then ask the agent to add entries ("add dossiers for the Year-3 students", "add the Sunforge duelling hall"). Entries accumulate as a JSON array; **View** renders them as readable cards (🔵/🟢/🔗 · name · keys · content), and *Edit raw JSON* drops to the underlying text.

**The agent owns every field.** You never hand-tune worldbooks — the Worldbook Maker chooses each setting from what the entry *is*, and explains non-obvious choices. Ask "King Britannia has 5 generals" and you get 6 differentiated entries (the king framed `before_char` at a higher order, the five generals each with their own keys/domain at a shared order so they rank together), not six identical blind ones.

Per entry it sets: **strategy** (🔵/🟢/🔗), **keys**, **order** (insertion priority — spine high, dossiers ~100–150, flavour low; a set like the five generals shares one order), **position** (`before_char` for world/setting lore that frames everything, `after_char` for who/what is on stage — the default, `at_depth` for live must-be-noticed-now lore like an active siege), **depth** (for `at_depth`), and **probability** (100 for facts, lower for intermittent flavour). Anything it has no reason to change falls back to safe defaults.

**Entry strategies** map to how ST activates each entry:

- 🔵 **blue** (constant) — always in context. Reserve for a tiny amount of spine lore that must never be absent; most spine lives in the PE, so blue is rare.
- 🟢 **green** (keyword) — fires when one of its keys appears in the conversation. **This is the default for almost every entry.** The agent gives each one a deliberate key list (name, aliases, epithets, words a scene would use).
- 🔗 **chain** (semantic/vector) — fires on semantic relatedness *if you have vectors enabled*. Never used alone, because with vectors off it becomes invisible. Instead every green entry is also exported **vector-eligible**, so it fires on keywords *and* — when you have vectors on — semantically too. Keywords are the floor that always works; vectors are a bonus layer.

**Export → SillyTavern:** the **🌐→ST** button (visible for worldbook docs) downloads a `.json` in ST's exact World Info schema. Import it via **SillyTavern → World Info → Import**. Mapping: blue→`constant`, green→keyed + selective + vector-eligible, chain→pure vectorized. The export also re-imports cleanly back into this extension (full round-trip), and warns about entries with no keys, empty content, or duplicate names.

**PE ↔ Worldbook interaction:** the two are one world. Attach the PE while editing the worldbook (entries respect canon); attach the worldbook while editing the PE (promote a background entry into the spine when the story makes it constant). The 🔗 reference system carries the actual content both ways, and you can target either document per-edit with the agent's `"doc"` field.

### Vector settings (if you enable embeddings)

Don't use all the ST defaults for worldbook recall — they're tuned for chat history:

- Enable vectorization **for World Info specifically** (separate toggle from chat vectorization), querying against recent messages.
- Raise the **score threshold** (roughly 0.35–0.5) — the default is often too loose for lore and pulls marginally-related entries, wasting tokens. Tune by watching what fires.
- Keep entries **one topic each** (the Worldbook Maker enforces this) so each embedding is semantically tight.
- The **local/built-in embedder** is fine on Termux; only move to an API embedder if you find recall weak. Don't pay until you feel a miss.
- Because every entry also has real keywords, if vectors are off or mis-tuned **nothing breaks** — keyword matching still fires. Vectors never become a single point of failure.

## Sessions & branching (like Continuity Copilot)

Each document holds multiple **sessions** — parallel conversations about the same document. The session row (under the document row) has the session dropdown plus **+ New / Branch / Ren / Del**; the ‹ n/m › swipe arrows work on the newest agent answer of whichever session is active.

Every user and agent message also carries a **🌿 branch icon**: it copies the conversation *up to and including that message* into a fresh session and switches to it, leaving the original untouched. That's also how you "swipe" an old answer: 🌿 it, and since it's now the last message of the branch, the ‹ › arrows appear and › generates alternatives — while the original session keeps the path you already had. Sessions share the document, its preset, references, and undo stack; only the conversation forks.

## Reference documents (compare & cross-edit)

The **🔗** button (next to the preset dropdown) attaches other documents to the active conversation as **read-only references**. They are sent in full every turn as `[REFERENCE DOCUMENT: name]` blocks — so watch tokens with several large files — and the subtitle shows `+N refs`.

Typical flow for "compare X and Y, then use Y as the base": open (or create) a conversation with **Y active**, attach **X** as a reference, then just talk — "compare these two", then "merge X's extra fields into Y". Because Y is the main `[DOCUMENT]`, edits land on Y by default; the conversation and its history stay in one place.

The agent can also target a reference directly: any edit may carry `"doc": "document name"`, and it applies to that attached document instead (the card shows `→ name`). So you can equally stay in X's conversation and say "edit Y from here on" — the direction lives in your words, not in the UI. Targets are restricted to the active document and its attached references; unknown or ambiguous names fail as a clean card status, never a wrong-document write.

**Undo is batch-aware:** one press reverts the most recent applied batch on *every* document it touched. Older steps fall back to per-document undo on the active document (a document changed since a batch is skipped with a note — switch to it and press Undo there). Deleting a document detaches it from all conversations; renaming is safe (references are tracked by id, and the agent always sees current names).

## Presets (many brains, one editing engine)

Three presets are seeded: *Plot Essential Maker* and *AI Instructions Maker* (placeholders — paste your instructions), and *Worldbook Maker* (a full working prompt, ready to use). Open the gear → **Edit in window** and paste your real instructions over the placeholder text — prompts can be 20,000+ characters, there are no length caps anywhere. The docedits protocol is appended in code after whatever the preset says, so **never paste the protocol into a preset**, and protocol upgrades in future versions apply without touching your presets.

The gear drawer always targets the *active document's* preset: live-editable textarea, **Edit in window** for comfortable large edits, **New** (creates + assigns to the current document), **Ren**, **Del** (built-ins can't be deleted), and **Reset default** (built-ins only). To edit a preset not assigned to any document, temporarily select it in the doc bar dropdown.

## Settings

- **LLM route** — Connection Profile, or "Current API" raw fallback.
- **Max tokens** — the ceiling for one reply (thinking included), not a target: the model stops when it's done, so setting it very high (up to 200,000 accepted) is safe *unless your provider rejects large values* — if a request errors, lower it. Deep-analysis replies on thinking models genuinely benefit from a high ceiling.
- **History depth** — recent messages sent per request (2–80).
- **Streaming / Show thinking** toggles.
- Settings save automatically.

## Troubleshooting

- **"No generation backend found"** — pick a Connection Profile in the gear settings, or update SillyTavern (the fallback needs a recent `generateRaw`).
- **Edit fails with "not located (even fuzzy)"** — the model misquoted too heavily; tell it "resend the edits, copy find verbatim from the document".
- **Panel shows an old version number** — cached files; hard-refresh / clear cached images.
- **Clipboard Paste button fails** — normal on http/LAN; long-press the textarea and paste manually (the Copy buttons fall back automatically).
- **Panel doesn't appear** — check the browser console for `[LoreAgent]` errors and report them.

## Development

`node --check index.js` plus `node test.js` (loads the extension under a stub `SillyTavern` global — proving a clean load and that the 3s init fallback can't crash — then runs 91 unit tests on the parsing/locating/applying engine).

## License

MIT.

## Changelog

- **0.11.15** — final-audit fix: the Escape key now correctly closes the 🔍 Check window without also exiting fullscreen (its window id wasn't in the float-window guard). Full audit otherwise clean: 161 engine tests + 80 DOM integration checks pass, every element ID resolves, no XSS surface, version/data-key intact.

- **0.11.14** — new **🔍 Check** button (DOC row): a deterministic linter that reads the raw document *in code*, not via the AI, so it can't hallucinate. It reports inline double-spaces (drawn with visible · dots so you can actually see them), trailing whitespace, tabs, and JSON validity — and offers one-tap **undoable** fixes: collapse double-spaces, and repair invalid JSON (escapes raw line breaks, keeps the content). This is the reliable way to settle "is that two spaces or one?" and to catch the JSON format errors a model misses — language models genuinely can't perceive whitespace, so that check belongs in code, not in the chat.

- **0.11.13** — tightened the fuzzy-apply rule to be exactly right for authored files. v0.11.12 applied a match when its first/last words lined up, which let an ~83% match through — and since the matcher ignores spacing, an 83% score means ~17% of the *words* differed, so applying it could quietly overwrite real text with the model's misquote. Now a fuzzy match applies **only when the difference is pure whitespace** (the words are provably identical, just re-spaced); any word or punctuation difference is refused and the agent re-quotes verbatim. Whitespace/double-space fixes still apply cleanly; a misquote can no longer be written over your instructions.

- **0.11.12** — corrected v0.11.10, which was too strict: it refused **every** approximate match to stop the duplication bug, but that also killed the safe case where only *whitespace* differed — so edits showed the absurd "matched approximately (100%), not applied." Now a fuzzy match applies when it is **edge-safe** (its first and last words match the document exactly), which mathematically guarantees no leftover fragment and no adjacent-line reflow, while letting whitespace-only differences through. A genuinely drifting match (different start/end words) is still refused and re-quoted. Also added protocol rule 10: the agent should make the change you asked for and **not** sweep in unrequested cosmetic edits (collapsing double spaces, tidying whitespace, deleting stray-quote artifacts) unless you ask for a cleanup pass.

- **0.11.11** — the docedits JSON parser now repairs the #1 model slip: **raw line breaks (and tabs) pasted inside `find`/`replace` values** instead of `\n`. Multi-line edits that used to fail with a JSON error now parse and apply. Valid JSON and already-escaped `\n` are left untouched. (Unescaped inner double-quotes still can't be auto-repaired safely — that's genuinely ambiguous — so protocol rule 4 now tells the model to use single quotes or escape them inside values.)

- **0.11.10** — fixed a defect where applying an edit could silently **duplicate a fragment or reflow indentation** in your document. Root cause: the matcher accepted an *approximate* (fuzzy) match, but its word-level boundaries didn't line up with what the model meant to change — leaving a leftover fragment (a doubled "gloss. gloss.") or snapping to a word boundary that flattened an adjacent line's indentation. The applier now only writes matches that are **exact** (character-for-character, with smart-quote/dash normalization) — those have precise boundaries and can't misalign. An inexact match no longer applies: it fails cleanly and the agent is told to re-quote the excerpt verbatim (it has the full document, so it can). Net: an edit either lands exactly as intended or fails safely — it never corrupts your text with a duplicated or reflowed fragment.

- **0.11.9** — when a proposed edit can't locate its excerpt, the failure is now fed back to the agent (a note it reads on the next turn) telling it to copy the excerpt character-for-character and resend — so it self-corrects instead of the failure sitting silently on a card. Matching stays **strict on purpose**: the agent edits your authored documents, and a looser fuzzy match on long text risks silently replacing the *wrong* passage, which is worse than a clean, recoverable failure. (This is why the agent does not adopt Chat Assistant's looser-threshold change — that was tuned for short structured memory, not long documents.)

- **0.11.8** — fixed a nested-scroll trap in the proposed-edit cards. The per-block scroll boxes added in 0.11.7 captured touch on mobile, so you couldn't drag past a card to reach the green "after" block. Removed them: the red "before" is now a short clipped preview (you can see the current text in the document / View editor) and the green "after" (the new text) flows in **full**, with the whole cards area as one smooth scroll — so even with a long reason and several stacked fixes, you can drag the cards region and read every green block.

- **0.11.7** — edit-cards area given more height (42% → 55%) so a tall proposal card no longer pushes the green "after" block below the fold. (The related Chat Assistant memory-path bug does not apply here: the agent edits document *text* via find/replace, not structured memory with paths/arrays, so there is no "unknown path" failure mode. Individual diff blocks are already capped with their own scroll, so a long "before" can't bury the green.)

- **0.11.6** — proposal-card readability fix (ported from Chat Assistant). Each edit's reason ("why") used to share the header row with the **Edit N** badge and the Apply/Skip buttons, truncated with an ellipsis — so a longer reason like "Remove Miranda's connection to Ostler's report…" clipped to "Remo…". It now sits on its own full-width line below the header and wraps, so you can read the whole explanation of each proposed edit; the header row keeps just the numbered badge and the buttons.

- **0.11.5** — two fixes ported from Chat Assistant. **(1) Session operations no longer discard pending proposals.** Switching sessions, tapping **+ New**, or **Branch** used to clear the proposed-edit cards — but those edits target the *document* (which every session of that document shares), so they now survive session navigation. Only switching *documents* clears them (the correct boundary). **(2) The agent now sees its own pending proposals and can supersede them.** Every proposed-edit card is numbered — **Edit 1**, **Edit 2**, … — so you can say "apply edit 2." Each turn the agent is shown a `[PENDING PROPOSALS]` list of what it proposed but you haven't applied, so it references those instead of blindly re-proposing; and when it revises one, it marks the stale card with a hidden supersede tag that auto-skips it — so **Apply all pending** applies the corrected version, never the stale one beside it. The header context meter counts this awareness block.

- **0.11.4** — renamed to **Plot Essential and Instructions Maker** (display name, panel header, wand-menu entry, slash help, and the protocol line the agent sees). The header title and subtitle now stack vertically so the longer name and the live context meter both fit on mobile. Repo renamed to `SillyTavern-Plot-Essential-and-Instructions-Maker` (old links redirect). No functional changes — the internal module id stays `loreAgent`, so every saved document and preset carries over untouched. Expanded this README and `AGENTS.md` so a fresh AI can understand the extension without reading the whole codebase, including the note that the internal id must never be renamed. Slash command is still `/lore`.

- **0.11.3** — deep audit pass, no behavior changes. Verified the whole surface end-to-end: 117 engine tests plus a new 61-check DOM integration harness (jsdom) that boots the extension and drives the real wired UI — worldbook manager CRUD, entry editor, validate & repair, from-doc import, promote across documents with cross-document undo, compare view, the compare→agent attach bridge, and the live context meter — asserting real state after each action. Edge cases confirmed safe: a dangling 🔗 reference (referenced doc deleted) is scrubbed and can't crash the context meter; compare caps at 4 documents; editing one worldbook entry leaves the others byte-identical; invalid worldbook JSON degrades to a readable message with a raw-JSON escape; the at-depth depth field shows/hides correctly. Added `__loreAgentDebug.getSettings()` — a read-only console hook returning the live settings (same object already reachable via SillyTavern's context; handy for inspecting your docs/presets from devtools).

- **0.11.2** — live context meter. The panel header now shows the estimated total context this session sends on the next message (`~Nk ctx`) next to the char count — the sum of system prompt + edit protocol, the document, all 🔗 references (sent in full), and the windowed conversation history, computed to mirror exactly what gets sent. It updates live after every message, document/reference change, and history-depth change. Tap the header subtitle for a one-line breakdown (system / document / references / history, with per-reference token counts) so you can see where the budget is going — useful when references start to dominate. (Also: `settings` now initializes to a valid default at load instead of null, so pre-init access can't NPE.)

- **0.11.1** — compare view now bridges to the agent. Compare (⚖) is a read-only viewer for *you* — it never fed anything to the agent, which surprised people who selected documents there expecting the agent to gain access. Each pane now has a **🔗 attach** toggle that attaches/detaches that document as a reference of the active doc (the active doc's own pane shows an "active" badge instead), and a permanent note spells out that Compare is view-only and that 🔗 is how you let the agent read a document. Attaching from Compare updates the panel's 🔗 count and reference bar live.

- **0.11.0** — worldbook workbench + document compare.
  - **Bugfix (silent data loss):** numeric worldbook fields emitted as JSON strings (`"order":"300"`, `"depth":"2"`, `"probability":"40"`) were being reset to defaults on load because the guard used `Number.isFinite` on the raw string. They are now coerced and preserved. If a model ever wrote quoted numbers, your per-entry tuning was quietly reverting — this stops that.
  - **Per-entry worldbook editing:** View on a worldbook now opens a manager with a card per entry. Edit any entry in a real form (name, strategy, keys, position, order, probability, depth, content, comment) — no hand-editing JSON. Add entries, delete entries, or pull one in from another document. Raw-JSON editing is still one tap away.
  - **Token budget:** the manager shows an estimated token total, a per-entry `~tok` count, and — critically — the **always-on subtotal** for blue (constant) entries, since that is the cost paid on every single message.
  - **Validate & repair:** one tap re-parses and rewrites the worldbook to clean, canonical JSON (coerces field types, normalizes formatting, drops redundant defaults). No-op if already clean.
  - **Promote / move:** move a worldbook entry into another document (e.g. your PE) — appends its content there and removes it from the worldbook, as a single undoable action (one Undo reverts both docs).
  - **Compare view (⚖ Cmp):** open 2–4 documents side by side to cross-reference for inspiration. Toggle between **columns** (horizontal, swipe on mobile) and **stacked** (vertical). Read-only, per-pane copy, selection + layout remembered.
  - **Context window:** `[STATE]` notes no longer count against the history-depth budget — the window now keeps the last *N real turns* and lets notes ride along, so a run of "Applied:" notes can't push actual conversation out of context.
  - **Polish:** Esc no longer exits fullscreen while a floating window (editor / worldbook manager / compare) is open — it closes that window first. Removed the superseded read-only worldbook text preview and fixed scrambled protocol-rule numbering.

- **0.10.3** — fix fullscreen collapsing to content height (composer floated mid-screen with ST showing through below). The fullscreen panel now has an explicit height = 100dvh minus the top offset, so it spans from just below the ST toolbar to the screen bottom.

- **0.10.2** — fullscreen now starts below the SillyTavern toolbar (concrete 56px offset, since Android WebView often reports safe-area insets as 0) so the panel header and its exit/close buttons are always fully visible and reachable.

- **0.10.1** — fix: in fullscreen the header (with the exit ⛶ and ✕ buttons) could hide under the phone status bar / ST toolbar. The header is now sticky with safe-area padding and larger tap targets, and **Esc exits fullscreen** as a fallback.

- **0.10.0** — ⛶ fullscreen toggle in the panel header: expands the panel to fill the screen for heavy authoring, tap again for the default floating size. Remembered across sessions.

- **0.9.0** — the Worldbook Maker now sets **every** SillyTavern field per entry with real reasoning, not blind constants: order (importance; sets share an order), position (before_char / after_char / at_depth), depth, and probability, on top of strategy and keys. The prompt teaches when each value is correct ("King Britannia has 5 generals" → 6 differentiated, set-aware entries). Exporter maps friendly position strings to ST codes and round-trips them; preview cards show position/order/depth. 13 new tests (91 total) + the 5-generals scenario verified end-to-end.

- **0.8.0** — worldbooks: a **Worldbook Maker** preset (full working prompt), **+WB** quick-create, readable entry cards in View, and **🌐→ST export** to SillyTavern's World Info JSON (blue→constant, green→keyed + vector-eligible, chain→vectorized) with lint warnings and clean round-trip re-import. Parser now also reads ST's `{entries:{…}}` object-map form (fixes re-importing an ST worldbook). README documents the PE-spine / worldbook-encyclopedia model and the vector-tuning advice.

- **0.7.0** — proposals are now a persistent staging area you can discuss around. Replying to talk no longer wipes pending cards (previously a chat-only answer cleared them); a refined proposal stacks below the earlier one under a divider for side-by-side comparison, with an **Apply newest** button when multiple batches are pending. Swiping the same reply still replaces its cards. The agent is told refinements stack, so "maybe it's better this way" yields one comparison card, not a re-dump.

- **0.6.0** — compact top bar: only the document + session dropdowns stay visible; preset, references, and all document/session buttons fold behind a ⋮ toggle (state remembered), giving the chat log back ~5 rows on phones. Chat log now keeps a minimum height; fixed a garbled Imp tooltip.

- **0.5.0** — final audit pass: fixed stale diff cards (cards now always mirror the reply on screen, so a swipe without edits can't leave outdated cards applyable); max-token ceiling raised to 200k with provider-rejection hints; Undo button shows backup depth and disables at zero; document dropdown shows sizes; full visual refresh (bigger touch targets, colored status chips — green applied / amber fuzzy / red failed, sticky card header, keyboard-aware phone height, focus outlines, thin scrollbars); added AGENTS.md so any future AI session can maintain the project.

- **0.4.2** — dragging rewritten: window-level pointer tracking (pointer capture is unreliable on Android WebViews and could make the panel undraggable) and the drag surface now covers the header, the whole document/session/reference bar, and the quick-button row. Scrolling areas and text inputs stay non-drag so the log still scrolls and text still selects.

- **0.4.1** — thinking box rebuilt as an explicit tap-to-expand toggle with inline styles (native `<details>` dropdown failed to expand on Android); header now shows the thinking size, body is capped at 40vh and scrolls.

- **0.4.0** — sessions per document (dropdown + New/Branch/Ren/Del) and a 🌿 branch icon on every user/agent message that forks the conversation from that point into a new session; existing conversations migrate automatically into "Session 1".

- **0.3.1** — ✕ Close button at the bottom of the settings drawer (the ⚙ gear also toggles it).

- **0.3.0** — reference documents: attach other docs to a conversation via 🔗 (sent read-only as `[REFERENCE DOCUMENT]` blocks), agent can target any attached doc per-edit with `"doc": "name"`, cards show the target, Undo reverts whole batches across every document they touched.

- **0.2.0** — import from device files via a File picker in the editor window (any text format; filename becomes the document name), export with a chosen filename/extension instead of forced `.md`, per-extension MIME types.

- **0.1.0** — first build: global document store with per-doc conversations/presets/undo, docedits protocol (find/replace, insert_after, append, replace_all), diff cards with fuzzy matching, streaming + thinking + swipes, draggable View/Edit and preset editor windows, import/export/copy, wand menu + `/lore`.
