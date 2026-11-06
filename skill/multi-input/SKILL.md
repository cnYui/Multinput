---
name: multi-input
description: Use the multi-input MCP to batch browser form edits, operate independent pages concurrently, or insert text through multiple anchored cursors in its local collaborative editor. Use one AI decision maker; choose action batches and concurrency from observations. Does not add multiple OS cursors to arbitrary desktop apps or edit Word/Google Docs directly.
---

# Multi Input

Use the `multi-input` MCP execution tools. They run deterministic browser/document operations and do not call another model. The current AI decides the content, targets, dependencies, and useful concurrency.

## Plan from observed state

1. Call `workspace_observe`. Open missing browser targets with `page_open`, then observe them for current element refs. Use `document_open` for an existing `.txt`/`.md` under the configured document root, or `document_create` for new text. Use the returned `max_parallel` and actual document line contents.
2. Group independent changes in one `execute_batch`. Choose `parallelism` from the number of independently executable resources and their dependencies, within the reported capacity. `auto` asks the executor to derive a capped resource count; it does not reason about task semantics.
3. For independent fields in one form, use one `form_patch` with multiple `{ref, op, value}` changes. Supported operations include `fill` (text, textarea, date, number), `set_checked` (radio/checkbox), and `select_option` (string for a dropdown or string array for a native multi-select). Read available select options from observation before choosing values. It uses DOM-directed synthetic events and final-value checks, not multiple physical mice. Ordinary Playwright actions on the same page serialize to avoid focus/scroll races. Different `page_id`s have isolated browser contexts and can overlap, including `type_text` keyboard sequences.
4. For a local editor document, read its current lines, choose non-overlapping lines, and acquire anchors with `cursor_lock`. The number of cursors is the number of useful independent edit locations, not a fixed ten. A column is a zero-based UTF-16 offset; omission means line end. Each line lease is exclusive. Submit one `document_insert` action per cursor in a batch. Relative Yjs anchors survive insertions before them; each active input lane uses its own synchronizing replica.
5. Add `after: [action_id]` when a result depends on an earlier action. For conditionally revealed form fields, execute the prerequisite, re-observe, then plan the next batch. Do not guess refs for hidden future fields.

If natural staggered input is requested, keep one batch and choose small varied `start_ms` offsets. For semantic form text changes, `typing_ms` controls per-grapheme input cadence; `preview_ms` allows an application-provided selection preview. For document/browser actions, `start_ms` delays the allocated lane and `pace_ms` controls supported typing. Use different offsets/cadences so tasks overlap without mechanically starting together. These are actual input timings, not just cursor animation.

## Verify and continue

`execute_batch` returns a job, not completed success. Poll `job_status` until it settles. Check each action's status, returned verification, and `peak_active`; re-observe the final field/document values before reporting the result. A successful `click` means input was dispatched, not that its intended application effect occurred.

On failure, inspect partial results and current state before retrying. Batches do not roll back earlier edits. Prefer idempotent `fill` and `set_checked` to blindly repeating clicks. `job_cancel` stops queued work and document typing at a grapheme boundary; an in-flight browser operation can finish. Release document cursors after verification with `cursor_release` when their leases are no longer needed.

Keep visual cursor counts separate from actual concurrency: one form patch can display ten target markers while running in one browser lane. Report that as a batch. Distinct page lanes or disjoint document leases can genuinely overlap as asynchronous tasks; their JavaScript events/CRDT transactions are still applied in an order. Never describe colored overlays as extra system mouse devices.

After the document job finishes, use `document_save` with a relative `.txt`/`.md` filename when the user wants a saved artifact; verify its read-back result. Documents otherwise live in memory. The editor is an adapter for local plain-text documents. Other editors require their own supported adapters; do not claim this tool can concurrently type into arbitrary Word, Google Docs, or canvas apps.

## First use

If the MCP tools are missing, explain that the MCP connection must be loaded in a new Codex session. The project includes a standalone client (`npm run call`) for protocol verification; a shell-driven client call is not proof that the current chat has hot-loaded a new native tool. Do not silently replace this executor with a different browser tool and claim the same capability.
