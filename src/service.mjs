import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { BrowserRuntime } from './browser.mjs';
import { DocumentStore, sleep } from './documents.mjs';
import { Scheduler } from './scheduler.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.MULTI_INPUT_PORT || 43187);
const baseUrl = `http://127.0.0.1:${port}`;
const documentRoot = path.resolve(process.env.MULTI_INPUT_DOCUMENT_ROOT || path.join(root, 'documents'));
const state = { stage: 'document', headline: '一个 AI，多条输入通道', subtitle: '真实 MCP 调用 · 实际文档更新 · 操作结果回读',
  forms: {}, tasks: {}, surfaceCursors: {}, events: [], ready: false, demonstration: 'idle' };
let updateTimer, wss, runtime;
const docs = new DocumentStore(changed);
const scheduler = new Scheduler({ maxParallel: 10, onChange: changed, execute: async (a, signal) => {
  if (a.start_ms) await sleep(a.start_ms);
  if (signal.aborted) throw new Error('Cancelled before delayed input began.');
  if (a.op === 'document_insert') return docs.insert(a.document_id, a.cursor_id, a.text, { paceMs: a.pace_ms ?? 0, signal });
  return runtime.run(a, signal);
} });
function snapshot() {
  return { ...state, documents: [...docs.docs.keys()].map(id => docs.snapshot(id)),
    pages: runtime ? [...runtime.targets.values()].map(p => ({ id: p.id, url: p.url })) : [],
    jobs: [...scheduler.jobs.keys()].map(id => scheduler.snapshot(id)), capabilities: { max_parallel: 10, browser_mode: runtime?.mode ?? 'starting',
      same_page_policy: 'serialize_browser_actions; form_patch_batches_multiple_fields',
      document_policy: 'concurrent_Yjs_replicas_with_exclusive_line_leases' } };
}
function changed() {
  if (updateTimer) return;
  updateTimer = setTimeout(() => { updateTimer = null; if (wss) for (const client of wss.clients) if (client.readyState === 1) client.send(JSON.stringify(snapshot())); }, 35);
}
function event(type, detail) { if (type === 'job_status') return; state.events.push({ at: Date.now(), type, detail }); state.events = state.events.slice(-40); changed(); }
async function documentPath(filename) {
  if (path.isAbsolute(filename)) throw new Error('Use a relative filename under the configured document root.');
  if (!/\.(txt|md)$/i.test(filename)) throw new Error('This adapter supports .txt and .md files.');
  const result = path.resolve(documentRoot, filename);
  if (!result.startsWith(documentRoot + path.sep)) throw new Error('Filename escapes the document root.');
  // Real-path containment also rejects a symlinked parent pointing outside the document root.
  await fs.mkdir(documentRoot, { recursive: true });
  await fs.mkdir(path.dirname(result), { recursive: true });
  const realRoot = await fs.realpath(documentRoot), realParent = await fs.realpath(path.dirname(result));
  if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) throw new Error('Symlinked directory escapes the document root.');
  try { const st = await fs.lstat(result); if (st.isSymbolicLink()) throw new Error('Symlinked document files are not supported.'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  return result;
}
async function invoke(name, args = {}) {
  event(name, name === 'execute_batch' ? `${args.actions?.length} 个动作 · 请求并发 ${args.parallelism ?? 'auto'}` : Object.keys(args).join(', '));
  if (name === 'workspace_observe') {
    const pages = [];
    for (const id of args.page_ids ?? [...runtime.targets.keys()]) pages.push(await runtime.observe(id, { selector: args.selector, include_links: args.include_links }));
    return { capabilities: snapshot().capabilities, pages, documents: [...docs.docs.keys()].map(id => docs.snapshot(id)), jobs: [...scheduler.jobs.keys()].map(id => scheduler.snapshot(id)) };
  }
  if (name === 'page_open') return runtime.open(args);
  if (name === 'page_attach') return runtime.attach(args);
  if (name === 'document_create') return docs.create(args);
  if (name === 'document_open') {
    const filename = await documentPath(args.filename);
    return docs.create({ id: args.id, title: path.basename(filename), text: await fs.readFile(filename, 'utf8') });
  }
  if (name === 'document_save') {
    const d = docs.get(args.document_id); if (d.busy.size) throw new Error('Wait for active writers before saving.');
    const filename = await documentPath(args.filename), document = docs.snapshot(args.document_id);
    const tmp = `${filename}.${process.pid}.tmp`;
    await fs.writeFile(tmp, document.text, 'utf8'); await fs.rename(tmp, filename);
    const verified = await fs.readFile(filename, 'utf8') === document.text;
    return { path: filename, revision: document.revision, verified, bytes: Buffer.byteLength(document.text) };
  }
  if (name === 'cursor_lock') return docs.lock(args.document_id, args.cursors);
  if (name === 'cursor_release') return docs.unlock(args.document_id, args.cursor_ids);
  if (name === 'execute_batch') {
    // Synchronous pre-validation covers document leases; browser refs are preflighted by each action.
    for (const a of args.actions) {
      if (a.op === 'document_insert') {
        if (!docs.get(a.document_id).cursors.get(a.cursor_id)?.lock) throw new Error(`Cursor ${a.cursor_id} is not locked.`);
      } else runtime.get(a.page_id);
    }
    return scheduler.submit(args.actions, args.parallelism ?? 'auto');
  }
  if (name === 'job_status') return scheduler.snapshot(args.job_id);
  if (name === 'job_cancel') return scheduler.cancel(args.job_id);
  throw new Error(`Unknown tool: ${name}`);
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) throw new Error('Payload too large.'); }
  return raw ? JSON.parse(raw) : {};
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, baseUrl);
    // This is a local bridge. Reject cross-origin mutation requests from arbitrary web pages.
    if (req.method === 'POST' && req.headers.origin && ![baseUrl, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Origin rejected.' });
    if (url.pathname === '/health') return json(res, 200, { service: 'multi-input-mcp', ready: state.ready, port });
    if (url.pathname === '/api/state') return json(res, 200, snapshot());
    if (url.pathname === '/rpc' && req.method === 'POST') {
      const { name, arguments: args } = await body(req);
      return json(res, 200, { result: await invoke(name, args) });
    }
    if (url.pathname === '/api/surface' && req.method === 'POST') {
      const data = await body(req);
      if (data.kind === 'form') state.forms[data.id] = { ...(state.forms[data.id] || {}), ...data.values };
      else if (data.kind === 'task') state.tasks[data.id] = { ...(state.tasks[data.id] || {}), ...data.values };
      changed(); return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/document' && req.method === 'POST') {
      const data = await body(req); return json(res, 200, docs.replace(data.id, data.text, data.revision));
    }
    if (url.pathname === '/api/demo' && req.method === 'POST') {
      const data = await body(req);
      for (const key of ['stage', 'headline', 'subtitle', 'demonstration']) if (data[key] !== undefined) state[key] = data[key];
      changed(); return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      if (scheduler.activeTotal) throw new Error('Wait for running jobs before resetting this demo workspace.');
      for (const p of runtime.targets.values()) await runtime.release(p);
      runtime.targets.clear();
      for (const d of docs.docs.values()) d.ydoc.destroy();
      docs.docs.clear(); scheduler.jobs.clear(); state.forms = {}; state.tasks = {}; state.surfaceCursors = {}; state.events = [];
      changed(); return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/record/start' && req.method === 'POST') {
      const { dir } = await body(req); await fs.mkdir(dir, { recursive: true }); return json(res, 200, await runtime.recordStart(dir));
    }
    if (url.pathname === '/api/record/stop' && req.method === 'POST') return json(res, 200, await runtime.recordStop());
    if (url.pathname === '/api/screenshot' && req.method === 'POST') { const { path: dest } = await body(req); return json(res, 200, await runtime.screenshot(dest)); }
    const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
      '/surface/form': ['form.html', 'text/html'], '/surface/task': ['task.html', 'text/html'], '/surface.js': ['surface.js', 'text/javascript'],
      '/film': ['film.html', 'text/html'], '/film.css': ['film.css', 'text/css'], '/film.js': ['film.js', 'text/javascript'], '/sheet': ['sheet.html', 'text/html'], '/sheet.js': ['sheet.js', 'text/javascript'] };
    const asset = assets[url.pathname]; if (!asset) return json(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': `${asset[1]}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(await fs.readFile(path.join(root, 'web', asset[0])));
  } catch (e) { json(res, 400, { error: e.message }); }
});
wss = new WebSocketServer({ server, path: '/events', verifyClient: ({ origin }) => !origin || [baseUrl, `http://localhost:${port}`].includes(origin) });
wss.on('connection', ws => ws.send(JSON.stringify(snapshot())));
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
runtime = new BrowserRuntime({ baseUrl, onChange: changed, onSurfaceCursors: (id, cursors) => { state.surfaceCursors[id] = cursors; changed(); } });
await runtime.start(); state.ready = true; changed();
process.stdout.write(`Multi Input ready at ${baseUrl}\n`);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await runtime.close(); wss.close(); server.close(); process.exit(0); });
