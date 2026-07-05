# Lore Agent (SillyTavern extension)

A floating chat panel where you talk to an AI agent about a markdown/text document, and the agent **edits the document directly** — surgical find/replace, insertions after an anchor, appends — shown as red/green diff cards you approve, with one-click Undo. Like a code-editing agent, but for lore and prompt documents.

Built for two document-authoring jobs (same editing engine, different agent brains via presets):

1. **Plot Essential (PE) documents** — world rules, magic systems, character dossiers, timelines, authored *before* a story exists.
2. **AI instruction sets** — system prompts, engine files, planner briefs.

Documents are **global and chat-independent**: they live in extension settings, need no character or chat loaded, and survive across everything. The extension never touches the chat, chat metadata, or chat events.

Sibling of Continuity Copilot — same engineering patterns, same author.

## Install

Option A — extension installer (recommended):
1. Put this folder in a GitHub repo with `manifest.json` at the repo root.
2. SillyTavern → Extensions (stacked blocks icon) → **Install extension** → paste the repo URL.

Option B — manual:
1. Copy the `lore-agent` folder into `SillyTavern/data/<your-user>/extensions/` (or `public/scripts/extensions/third-party/` on older layouts).
2. Restart SillyTavern / reload the page.

**After every update: hard-refresh or clear cached images.** Mobile browsers cache extension files aggressively; the version stamp in the panel header (and in the editor window title, and in the console `[LoreAgent] ready v…` line) is the only proof of which code is actually running. If the header version doesn't match the manifest you installed, you are running a cached copy.

## Setup

1. Wand menu (Extensions menu next to the chat input) → **Lore Agent**. Or type `/lore`.
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

## Sessions & branching (like Continuity Copilot)

Each document holds multiple **sessions** — parallel conversations about the same document. The session row (under the document row) has the session dropdown plus **+ New / Branch / Ren / Del**; the ‹ n/m › swipe arrows work on the newest agent answer of whichever session is active.

Every user and agent message also carries a **🌿 branch icon**: it copies the conversation *up to and including that message* into a fresh session and switches to it, leaving the original untouched. That's also how you "swipe" an old answer: 🌿 it, and since it's now the last message of the branch, the ‹ › arrows appear and › generates alternatives — while the original session keeps the path you already had. Sessions share the document, its preset, references, and undo stack; only the conversation forks.

## Reference documents (compare & cross-edit)

The **🔗** button (next to the preset dropdown) attaches other documents to the active conversation as **read-only references**. They are sent in full every turn as `[REFERENCE DOCUMENT: name]` blocks — so watch tokens with several large files — and the subtitle shows `+N refs`.

Typical flow for "compare X and Y, then use Y as the base": open (or create) a conversation with **Y active**, attach **X** as a reference, then just talk — "compare these two", then "merge X's extra fields into Y". Because Y is the main `[DOCUMENT]`, edits land on Y by default; the conversation and its history stay in one place.

The agent can also target a reference directly: any edit may carry `"doc": "document name"`, and it applies to that attached document instead (the card shows `→ name`). So you can equally stay in X's conversation and say "edit Y from here on" — the direction lives in your words, not in the UI. Targets are restricted to the active document and its attached references; unknown or ambiguous names fail as a clean card status, never a wrong-document write.

**Undo is batch-aware:** one press reverts the most recent applied batch on *every* document it touched. Older steps fall back to per-document undo on the active document (a document changed since a batch is skipped with a note — switch to it and press Undo there). Deleting a document detaches it from all conversations; renaming is safe (references are tracked by id, and the agent always sees current names).

## Presets (many brains, one editing engine)

Two presets are seeded as **placeholders**: *Plot Essential Maker* and *AI Instructions Maker*. Open the gear → **Edit in window** and paste your real instructions over the placeholder text — prompts can be 20,000+ characters, there are no length caps anywhere. The docedits protocol is appended in code after whatever the preset says, so **never paste the protocol into a preset**, and protocol upgrades in future versions apply without touching your presets.

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

`node --check index.js` plus `node test.js` (loads the extension under a stub `SillyTavern` global — proving a clean load and that the 3s init fallback can't crash — then runs 45 unit tests on the parsing/locating/applying engine).

## License

MIT.

## Changelog

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
