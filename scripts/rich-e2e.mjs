// Verifies the adapters a real upload page needs: rich text, hidden file inputs, file chooser buttons,
// custom dropdowns, Enter-to-create tags and switches, all driven through the real MCP client.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { connect, call, waitJob } from './session.mjs';

const fixture = await fs.readFile(new URL('../tests/fixtures/upload-form.html', import.meta.url));
const site = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fixture); });
await new Promise(r => site.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${site.address().port}/`;
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mi-upload-'));
const video = path.join(tmp, '上传版.mp4'), cover = path.join(tmp, '封面.png');
await fs.writeFile(video, 'fake video'); await fs.writeFile(cover, 'fake image');
const client = await connect();
const run = async (actions) => { const job = await waitJob(client, await call(client, 'execute_batch', { actions })); assert.equal(job.status, 'done', JSON.stringify(job.actions.map(a => [a.id, a.status, a.error]))); return job; };
try {
  await fetch(`${process.env.MULTI_INPUT_URL || 'http://127.0.0.1:' + (process.env.MULTI_INPUT_PORT || 43187)}/api/reset`, { method: 'POST' }).catch(() => {});
  await call(client, 'page_open', { id: 'up', url });
  const [page] = (await call(client, 'workspace_observe', { page_ids: ['up'] })).pages;
  const byRef = Object.fromEntries(page.elements.map(e => [e.ref, e]));
  assert.equal(byRef['video-file'].role, 'file'); assert.equal(byRef.desc.role, 'contenteditable'); assert.equal(byRef.title.label, '请输入稿件标题');
  const desc = '本期日报：\n1. 模型发布\n2. 产品更新';
  const p = 'up';
  const job = await run([
    { id: 'video', op: 'upload', page_id: p, ref: 'video-file', value: video },
    { id: 'text', op: 'form_patch', page_id: p, changes: [{ ref: 'title', op: 'fill', value: 'AI每日日报 11月8日' }, { ref: 'desc', op: 'fill', value: desc }] },
    { id: 'zone-open', op: 'click_text', page_id: p, value: '请选择分区' },
    { id: 'zone-pick', op: 'click_text', page_id: p, selector: '#zone-list', value: '知识', exact: true, after: ['zone-open'] },
    ...['AI', '日报'].flatMap((t, i) => [
      { id: `tag${i}`, op: 'fill', page_id: p, ref: 'tag-input', value: t },
      { id: `tag${i}-enter`, op: 'press', page_id: p, ref: 'tag-input', value: 'Enter', after: [`tag${i}`] }]),
    { id: 'ai', op: 'click', page_id: p, ref: 'ai-switch' },
    { id: 'cover', op: 'upload', page_id: p, ref: 'cover-btn', value: cover },
    { id: 'video-done', op: 'wait_text', page_id: p, value: '上传完成', timeout_ms: 5000, after: ['video'] }
  ]);
  const st = await call(client, 'workspace_observe', { page_ids: ['up'] });
  const descEl = st.pages[0].elements.find(e => e.ref === 'desc');
  assert.equal(descEl.text.replace(/\s+/g, ' ').trim(), desc.replace(/\s+/g, ' ').trim());
  assert.equal(st.pages[0].elements.find(e => e.ref === 'title').value, 'AI每日日报 11月8日');
  const fixtureState = await call(client, 'workspace_observe', { page_ids: ['up'] });
  assert.equal(job.actions.find(a => a.id === 'video').result.verified, true);
  assert.deepEqual(job.actions.find(a => a.id === 'cover').result.actual, ['封面.png']);
  assert.equal(fixtureState.pages[0].elements.find(e => e.ref === 'ai-switch').checked, true);
  await assert.rejects(() => run([{ id: 'bad', op: 'upload', page_id: p, ref: 'video-file', value: 'relative.mp4' }]), /absolute/);
  console.log(`PASS rich upload form: ${job.actions.length} actions, ${job.finished_at - job.started_at} ms`);
} finally { await client.close(); site.closeAllConnections(); site.close(); await fs.rm(tmp, { recursive: true, force: true }); }
