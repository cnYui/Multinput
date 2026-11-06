import { connect, call } from './call.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
export { connect, call, sleep };
export const base = process.env.MULTI_INPUT_URL || `http://127.0.0.1:${process.env.MULTI_INPUT_PORT || 43187}`;
export const initialText = [
  '# 多通道输入：实现说明', '',
  '目标：一个 AI，自主决定同时做多少件事。', '',
  '浏览器：', '键盘：', '文档：', '验证：', '',
  '结论：从逐次操作，升级为批量与并发执行。'
].join('\n');
export async function post(endpoint, data = {}) {
  const r = await fetch(`${base}${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const out = await r.json(); if (!r.ok) throw new Error(out.error || 'Request failed'); return out;
}
export async function setup(client) {
  await call(client, 'workspace_observe', { page_ids: [] });
  await post('/api/reset');
  await call(client, 'document_create', { id: 'notes', title: 'concurrent-notes.txt', text: initialText });
  const targets = [{ id: 'form', url: `${base}/surface/form?id=form` }, ...['research', 'outline', 'checklist'].map(id => ({ id, url: `${base}/surface/task?id=${id}` }))];
  await Promise.all(targets.map(p => call(client, 'page_open', p)));
  return call(client, 'workspace_observe', {});
}
export async function waitJob(client, job, onTick) {
  for (let i = 0; i < 400; i++) {
    const status = await call(client, 'job_status', { job_id: job.id });
    onTick?.(status);
    if (status.status !== 'running') return status;
    await sleep(100);
  }
  throw new Error('Job did not finish in time.');
}
export const documentActions = (pace = 0) => [
  { id: 'document-browser', cursor_id: '光标 A', text: '\n  ↳ 十个字段一次提交，选项与文本均可批量填写。' },
  { id: 'document-keyboard', cursor_id: '光标 B', text: '三个独立页面分别接收输入，不争抢同一个键盘焦点。' },
  { id: 'document-anchor', cursor_id: '光标 C', text: '锁定不同的行；前面新增换行，后面的插入位置仍然正确。' },
  { id: 'document-verify', cursor_id: '光标 D', text: '回读每项实际结果，检查内容完整、位置正确，没有相互覆盖。' }
].map(a => ({ ...a, document_id: 'notes', op: 'document_insert', pace_ms: pace }));
export const cursors = [5, 6, 7, 8].map((line, i) => ({ id: `光标 ${String.fromCharCode(65 + i)}`, line }));
export const answers = ['B', 'C', 'A', 'D', 'B', 'A', 'C', 'D', 'A', 'B'];
export const explanations = ['批量执行', '独立通道', '按依赖拆分', '结构化观察', '定向输入', '稳定位置锚点', '范围锁', '逐项反馈', '最终状态回读', '同一个 AI'];
export const choicesAction = { id: 'ten-choices', op: 'form_patch', page_id: 'form', changes: answers.map((x, i) => ({ ref: `q${i+1}-${x}`, op: 'set_checked', value: true })) };
export const fieldsAction = { id: 'ten-fields', op: 'form_patch', page_id: 'form', changes: explanations.map((value, i) => ({ ref: `note${i+1}`, op: 'fill', value })) };
export const keyboardActions = (pace = 0) => [
  ['research', '单 AI 可以观察多个页面，并一次下发完整操作计划。'],
  ['outline', 'MCP 接收批次，执行器负责多通道输入和冲突处理。'],
  ['checklist', '核对十道题、十个输入框，以及四个文档插入位置。']
].map(([page_id, value], i) => ({ id: `keyboard-${i+1}`, op: 'type_text', page_id, ref: 'task-input', value, pace_ms: pace }));
