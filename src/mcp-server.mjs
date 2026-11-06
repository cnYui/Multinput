import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.MULTI_INPUT_URL || `http://127.0.0.1:${process.env.MULTI_INPUT_PORT || 43187}`;
async function health() { try { const r = await fetch(`${base}/health`); const d = await r.json(); return d.service === 'multi-input-mcp' && d.ready; } catch { return false; } }
async function ensureRuntime() {
  if (await health()) return;
  if (process.env.MULTI_INPUT_URL) throw new Error('The configured MULTI_INPUT_URL is not a ready runtime.');
  const logdir = path.join(root, '.runtime'); fs.mkdirSync(logdir, { recursive: true });
  const fd = fs.openSync(path.join(logdir, 'service.log'), 'a');
  const child = spawn(process.execPath, [path.join(root, 'src/service.mjs')], { detached: true, stdio: ['ignore', fd, fd], env: process.env });
  child.unref(); fs.closeSync(fd);
  for (let i = 0; i < 100; i++) { if (await health()) return; await new Promise(r => setTimeout(r, 150)); }
  throw new Error(`Runtime did not start. Inspect ${logdir}/service.log and install Chromium with npx playwright install chromium.`);
}
const server = new McpServer({ name: 'multi-input', version: '0.1.0' }, { instructions:
  'One AI controls this executor; no additional LLM is called. Observe pages/documents first. Batch independent actions and choose parallelism from the observed max_parallel, task dependencies, and number of independent resources. Use form_patch for independent fields on one page. Browser actions on a page serialize; separate pages run concurrently. Lock disjoint document lines before document_insert; anchors survive earlier edits. Poll job_status, inspect each result, and read back final state. A dispatched click alone does not prove its effect. Cancellation retains completed mutations. Cursor colors are visualization of execution channels, not OS mouse devices.' });

const change = z.object({ ref: z.string(), op: z.enum(['fill', 'set_checked', 'select_option']), value: z.union([z.string(), z.boolean(), z.array(z.string())]),
  start_ms: z.number().int().min(0).max(10000).optional(), typing_ms: z.number().int().min(0).max(150).optional(), preview_ms: z.number().int().min(0).max(1500).optional() });
const action = z.object({
  id: z.string(), op: z.enum(['form_patch', 'fill', 'type_text', 'set_checked', 'select_option', 'click', 'document_insert']),
  page_id: z.string().optional(), ref: z.string().optional(), value: z.union([z.string(), z.boolean(), z.array(z.string())]).optional(),
  changes: z.array(change).min(1).max(100).optional(), document_id: z.string().optional(), cursor_id: z.string().optional(),
  text: z.string().optional(), pace_ms: z.number().int().min(0).max(200).optional(), start_ms: z.number().int().min(0).max(10000).optional(), after: z.array(z.string()).optional()
}).superRefine((a, ctx) => {
  const fail = message => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (a.op === 'document_insert' && (!a.document_id || !a.cursor_id || a.text === undefined)) fail('document_insert needs document_id, cursor_id, text');
  else if (a.op !== 'document_insert' && !a.page_id) fail('Browser actions need page_id');
  if (a.op === 'form_patch' && !a.changes?.length) fail('form_patch needs changes');
  if (!['form_patch', 'document_insert'].includes(a.op) && !a.ref) fail('This action needs ref');
  if (['fill', 'type_text'].includes(a.op) && typeof a.value !== 'string') fail('Text input needs a string value');
  if (a.op === 'set_checked' && typeof a.value !== 'boolean') fail('set_checked needs a boolean value');
  if (a.op === 'select_option' && typeof a.value !== 'string' && !Array.isArray(a.value)) fail('select_option needs a string or string array');
  for (const c of a.changes ?? []) if ((c.op === 'fill' && typeof c.value !== 'string') || (c.op === 'set_checked' && typeof c.value !== 'boolean') || (c.op === 'select_option' && typeof c.value !== 'string' && !Array.isArray(c.value))) fail('Patch value type does not match its operation');
});
function tool(name, description, inputSchema) {
  server.registerTool(name, { description, inputSchema }, async args => {
    try {
      await ensureRuntime();
      const response = await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) });
      const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error || 'Runtime request failed.');
      return { content: [{ type: 'text', text: JSON.stringify(result.result) }], structuredContent: result.result };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
  });
}
tool('workspace_observe', 'Read current browser elements, stable refs, document lines, cursors, jobs and actual concurrency capacity. Use before planning mutations.', { page_ids: z.array(z.string()).optional() });
tool('page_open', 'Open an http(s) page in its own isolated browser context. Separate page_ids are independently executable input lanes.', { id: z.string(), url: z.string().url() });
tool('document_create', 'Create an in-memory collaborative plain-text document in the local editor. Return line/column offsets. Does not edit Word or Google Docs.', { id: z.string(), title: z.string(), text: z.string().max(100000) });
tool('document_open', 'Open a local .txt or .md file under MULTI_INPUT_DOCUMENT_ROOT (default: project/documents). filename must be relative. Creates an editable in-memory document with a new id.', { id: z.string(), filename: z.string() });
tool('document_save', 'Save a completed document as .txt or .md under the configured document root and verify the bytes by reading it back. Wait for writers first. filename must be relative.', { document_id: z.string(), filename: z.string() });
tool('cursor_lock', 'Atomically acquire exclusive line leases and stable Yjs cursor anchors. AI chooses the number of disjoint cursors. Columns are zero-based UTF-16 offsets; omitted means end of line.', { document_id: z.string(), cursors: z.array(z.object({ id: z.string(), line: z.number().int().min(1), column: z.number().int().min(0).optional() })).min(1).max(10) });
tool('cursor_release', 'Release completed document cursor leases; cannot release active writers.', { document_id: z.string(), cursor_ids: z.array(z.string()) });
tool('execute_batch', 'Execute one AI-authored action batch. Choose parallelism explicitly or auto. Independent pages/cursor leases can overlap; same-page browser actions serialize. form_patch supports text, radio, checkbox, select/multi-select, date and number fields with synthetic events and final-state checks. Optional per-change start_ms/typing_ms staggers independent field updates inside a single batch; action start_ms delays an allocated lane. No rollback. Returns a job object with id; poll job_status. Timing options aid presentation, not speed benchmarking.', { actions: z.array(action).min(1).max(100), parallelism: z.union([z.literal('auto'), z.number().int().min(1).max(10)]).default('auto') });
tool('job_status', 'Return per-action timestamps, status, results, peak actual concurrency, and partial errors for an existing job.', { job_id: z.string() });
tool('job_cancel', 'Cancel queued actions and stop document typing at the next grapheme. An in-flight browser action may finish. Completed edits are retained.', { job_id: z.string() });
await server.connect(new StdioServerTransport());
