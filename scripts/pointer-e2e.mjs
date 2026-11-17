// Verifies the pointer adapters real upload pages need: hover-only controls, selector clicks on
// non-interactive areas, and component-library radios / ARIA switches that ignore synthetic clicks.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { connect, call, waitJob } from './session.mjs';

const fixture = await fs.readFile(new URL('../tests/fixtures/pointer-form.html', import.meta.url));
const site = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fixture); });
await new Promise(r => site.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${site.address().port}/`;
const client = await connect();
const batch = async (actions) => waitJob(client, await call(client, 'execute_batch', { actions }));
const run = async (actions) => { const job = await batch(actions); assert.equal(job.status, 'done', JSON.stringify(job.actions.map(a => [a.id, a.status, a.error]))); return job; };
const observe = async () => (await call(client, 'workspace_observe', { page_ids: ['pt'] })).pages[0].elements;
try {
  await fetch(`${process.env.MULTI_INPUT_URL || 'http://127.0.0.1:' + (process.env.MULTI_INPUT_PORT || 43187)}/api/reset`, { method: 'POST' }).catch(() => {});
  await call(client, 'page_open', { id: 'pt', url });
  const p = 'pt';

  // Without hovering, the edit button is not rendered, so click_text cannot reach it.
  const miss = await batch([{ id: 'nohover', op: 'click_text', page_id: p, selector: '#cover', value: '编辑', exact: true, timeout_ms: 800 }]);
  assert.equal(miss.status, 'failed');

  const els = await observe();
  const radio = els.find(e => e.label === '内容由AI生成'), radio2 = els.find(e => e.label === '无需添加自主声明'), sw = els.find(e => e.label === '原创声明');
  assert.ok(radio && radio2 && sw, 'radios and switch are observable');
  const job = await run([
    { id: 'hover', op: 'hover', page_id: p, selector: '#cover', hold_ms: 100 },
    { id: 'edit', op: 'click_text', page_id: p, selector: '#cover', value: '编辑', exact: true, after: ['hover'] },
    { id: 'slot', op: 'click', page_id: p, selector: '#slot', after: ['edit'] },
    { id: 'decl', op: 'form_patch', page_id: p, after: ['slot'], changes: [{ ref: radio.ref, op: 'set_checked', value: true }, { ref: sw.ref, op: 'set_checked', value: true }] }
  ]);
  const patch = job.actions.find(a => a.id === 'decl').result;
  assert.ok(patch.targets.every(t => t.verified && t.via === 'label_click'), JSON.stringify(patch.targets));

  const after = await observe();
  assert.equal(after.find(e => e.label === '内容由AI生成').checked, true);
  assert.equal(after.find(e => e.label === '原创声明').checked, true);
  const stateText = await call(client, 'execute_batch', { actions: [{ id: 'w', op: 'wait_text', page_id: p, value: '封面编辑已打开 / 封面槽已点击', exact: true, timeout_ms: 2000 }] });
  assert.equal((await waitJob(client, stateText)).status, 'done');

  // Single-action set_checked on the other option also falls back to a label click.
  const single = await run([{ id: 'single', op: 'set_checked', page_id: p, ref: after.find(e => e.label === '无需添加自主声明').ref, value: true }]);
  assert.equal(single.actions[0].result.verified, true);
  const last = await observe();
  assert.equal(last.find(e => e.label === '无需添加自主声明').checked, true);
  assert.equal(last.find(e => e.label === '内容由AI生成').checked, false);

  console.log(`PASS pointer form: hover-only button, selector click, controlled radio + ARIA switch via label click (${job.finished_at - job.started_at} ms)`);
} finally { await client.close(); site.closeAllConnections(); site.close(); }
