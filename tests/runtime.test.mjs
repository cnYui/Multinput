import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentStore, sleep } from '../src/documents.mjs';
import { Scheduler } from '../src/scheduler.mjs';

async function finished(s, id) {
  const end = Date.now() + 4000;
  while (s.snapshot(id).status === 'running') { if (Date.now() > end) throw new Error('Job timed out.'); await sleep(5); }
  return s.snapshot(id);
}
test('concurrent Yjs replicas keep lower anchors stable while upper text adds newlines and emoji', async () => {
  const d = new DocumentStore(); d.create({ id: 'a', text: '开头：\n中间：\n结尾：' });
  d.lock('a', [{ id: 'upper', line: 1 }, { id: 'lower', line: 3 }]);
  await Promise.all([
    d.insert('a', 'upper', '新内容👩‍💻\n增加一行', { paceMs: 2 }),
    d.insert('a', 'lower', '正确落在结尾✅', { paceMs: 3 })
  ]);
  assert.equal(d.snapshot('a').text, '开头：新内容👩‍💻\n增加一行\n中间：\n结尾：正确落在结尾✅');
  assert.ok(d.snapshot('a').cursors.every(c => c.status === 'done'));
});
test('lease request is atomic and overlapping lines are rejected', () => {
  const d = new DocumentStore();d.create({ id:'a', text:'one\ntwo\nthree' });
  d.lock('a',[{id:'first',line:1}]);
  assert.throws(()=>d.lock('a',[{id:'second',line:2},{id:'bad',line:1}]),/overlap/);
  assert.deepEqual(d.snapshot('a').cursors.map(c=>c.id),['first']);
});
test('same cursor cannot host two writers and a busy cursor cannot be released', async()=>{
  const d=new DocumentStore();d.create({id:'a',text:'line'});d.lock('a',[{id:'c',line:1}]);
  const active=d.insert('a','c','longer text',{paceMs:3});
  await assert.rejects(()=>d.insert('a','c','bad'),/active writer/);
  assert.throws(()=>d.unlock('a',['c']),/writing/);await active;
});
test('independent resources overlap; same resource serializes across batches',async()=>{
  let n=0,peak=0;const occupied=new Set();
  const s=new Scheduler({maxParallel:3,execute:async a=>{
    assert.ok(!occupied.has(a.page_id));occupied.add(a.page_id);n++;peak=Math.max(peak,n);
    await sleep(20);n--;occupied.delete(a.page_id);return{verified:true};
  }});
  const a=s.submit([{id:'a',op:'fill',page_id:'p1'},{id:'b',op:'fill',page_id:'p1'},{id:'c',op:'fill',page_id:'p2'}],3);
  const b=s.submit([{id:'d',op:'fill',page_id:'p1'},{id:'e',op:'fill',page_id:'p3'}],3);
  await Promise.all([finished(s,a.id),finished(s,b.id)]);assert.equal(peak,3);assert.equal(s.snapshot(a.id).status,'done');
});
test('dependencies gate execution, cycles fail before mutation, and failures skip dependents',async()=>{
  const order=[];const s=new Scheduler({execute:async a=>{order.push(a.id);if(a.id==='bad')throw new Error('expected failure');return{verified:true};}});
  assert.throws(()=>s.submit([{id:'x',op:'fill',page_id:'p1',after:['y']},{id:'y',op:'fill',page_id:'p2',after:['x']}]),/cycle/);
  assert.deepEqual(order,[]);
  const j=s.submit([{id:'bad',op:'fill',page_id:'p1'},{id:'later',op:'fill',page_id:'p2',after:['bad']}]);
  const done=await finished(s,j.id);assert.equal(done.status,'failed');assert.equal(done.actions[1].status,'skipped');assert.deepEqual(order,['bad']);
});
test('cancellation preserves completed mutations and stops queued actions',async()=>{
  const applied=[];const s=new Scheduler({execute:async a=>{applied.push(a.id);await sleep(30);return{verified:true};}});
  const j=s.submit([{id:'one',op:'fill',page_id:'p1'},{id:'two',op:'fill',page_id:'p1'}]);
  await sleep(5);s.cancel(j.id);const done=await finished(s,j.id);
  assert.deepEqual(applied,['one']);assert.equal(done.status,'cancelled');assert.equal(done.actions[0].status,'done');assert.equal(done.actions[1].status,'cancelled');
});
test('document cancellation retains a valid, merged partial insertion',async()=>{
  const d=new DocumentStore();d.create({id:'a',text:'anchor:'});d.lock('a',[{id:'c',line:1}]);
  const ctl=new AbortController();const p=d.insert('a','c','abcdefghijk',{paceMs:8,signal:ctl.signal});
  await sleep(19);ctl.abort();await assert.rejects(()=>p,/Cancelled/);
  const out=d.snapshot('a');assert.ok(out.text.startsWith('anchor:a'));assert.ok(out.text.length<'anchor:abcdefghijk'.length);assert.equal(out.cursors[0].status,'cancelled');
});
