import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { connect, call, setup, waitJob, sleep, post, documentActions, choicesAction, fieldsAction, keyboardActions, answers, explanations, initialText } from './session.mjs';

const output = path.resolve(process.argv[2] || 'demo-results'); await fs.mkdir(output,{recursive:true});
const client=await connect(), transcript=[], started=Date.now();let recording=false;
async function invoke(name,args={}){
  const at=Date.now();const result=await call(client,name,args);
  transcript.push({at_ms:at-started,tool:name,arguments:args,result});return result;
}
async function wait(job){
  const result=await waitJob(client,job);assert.equal(result.status,'done',JSON.stringify(result));
  transcript.push({at_ms:Date.now()-started,tool:'job_status',arguments:{job_id:job.id},result});return result;
}
async function stage(stage,headline,subtitle){await post('/api/demo',{stage,headline,subtitle,demonstration:'recording'});}
async function shot(name){await sleep(180);await post('/api/screenshot',{path:path.join(output,name)});}
try{
  const observed=await setup(client);
  const doc=observed.documents.find(d=>d.id==='notes');
  const sections=doc.lines.filter(l=>/^(浏览器|键盘|文档|验证)：$/.test(l.text));
  assert.equal(sections.length,4);
  const selectedCursors=sections.map((l,i)=>({id:`光标 ${String.fromCharCode(65+i)}`,line:l.line}));
  const plan={
    author:'Codex in the current chat',
    mode:'Replay of a Codex-authored plan through a real MCP stdio client; no hidden LLM calls.',
    decisions:[
      {task:'document',observed_independent_targets:sections.map(l=>({line:l.line,text:l.text})),chosen_cursors:selectedCursors.length,chosen_parallelism:4,reason:'Four independently editable sections; acquire four exclusive line leases.'},
      {task:'form',observed_radio_options:observed.pages.find(p=>p.id==='form').elements.filter(e=>e.role==='radio').length,observed_text_fields:10,chosen_target_markers:10,chosen_parallelism:1,reason:'One shared page: group ten choices and ten text values into semantic DOM patches.'},
      {task:'keyboard',observed_independent_pages:observed.pages.filter(p=>p.id!=='form').map(p=>p.id),chosen_parallelism:3,reason:'Three independent browser contexts allow overlapping keyboard sequences.'}
    ]};
  await fs.writeFile(path.join(output,'demo-plan.json'),JSON.stringify(plan,null,2));
  await stage('document','一个 AI，自主分配输入通道','本次 Codex 计划：4 个文档光标 → 10 个表单目标 → 3 路页面输入');
  await post('/api/record/start',{dir:path.join(output,'.capture')});recording=true;
  await sleep(2500);
  await stage('document','四个光标，锁定同一文档的不同位置','依据观察选择 4 个独立段落 · 范围锁已获取后开始写入');
  await invoke('cursor_lock',{document_id:'notes',cursors:selectedCursors});await sleep(2200);
  const docJob=await invoke('execute_batch',{actions:documentActions(140),parallelism:4});
  await sleep(1100);await shot('demo-document-writing.png');
  const completedDoc=await wait(docJob);assert.equal(completedDoc.peak_active,4);
  const afterDoc=await invoke('workspace_observe',{page_ids:[]});
  const finalText=afterDoc.documents.find(d=>d.id==='notes').text;
  const expected=initialText.replace('浏览器：','浏览器：'+documentActions()[0].text).replace('键盘：','键盘：'+documentActions()[1].text).replace('文档：','文档：'+documentActions()[2].text).replace('验证：','验证：'+documentActions()[3].text);
  assert.equal(finalText,expected);
  await stage('document','前面的行变长，后面的光标仍在正确位置','4 路写入实际重叠；新增换行后，四段内容全部回读一致');
  const saved=await invoke('document_save',{document_id:'notes',filename:'concurrent-notes.md'});assert.ok(saved.verified);
  await fs.copyFile(saved.path,path.join(output,'final-document.md'));await shot('demo-document.png');await sleep(3200);

  await stage('form','十道题，一次批量选择','同一页面使用一个执行通道；十个标记对应十个真实操作目标');await sleep(2500);
  const choiceJob=await wait(await invoke('execute_batch',{actions:[choicesAction],parallelism:1}));
  assert.equal(choiceJob.peak_active,1);await sleep(2800);
  await stage('form','十个输入框，也可以一次填好','文本直接定向填写；完成后回读 10 个选项和 10 个文本值');
  const fieldJob=await wait(await invoke('execute_batch',{actions:[fieldsAction],parallelism:1}));
  const observedForm=await invoke('workspace_observe',{page_ids:['form']});const elements=observedForm.pages[0].elements;
  answers.forEach((x,i)=>assert.equal(elements.find(e=>e.ref===`q${i+1}-${x}`).checked,true));
  explanations.forEach((x,i)=>assert.equal(elements.find(e=>e.ref===`note${i+1}`).value,x));
  await shot('demo-form.png');await sleep(3600);

  await stage('pages','同一个 AI，三个页面同时输入','3 个独立浏览器上下文 · 真实逐字键盘事件 · 不争抢焦点');await sleep(2600);
  const keyboardJob=await invoke('execute_batch',{actions:keyboardActions(140),parallelism:3});
  await sleep(1100);await shot('demo-pages-writing.png');
  const completedKeyboard=await wait(keyboardJob);assert.equal(completedKeyboard.peak_active,3);
  const actualPages=await invoke('workspace_observe',{page_ids:['research','outline','checklist']});
  for(const a of keyboardActions())assert.equal(actualPages.pages.find(p=>p.id===a.page_id).elements.find(e=>e.ref==='task-input').value,a.value);
  assert.ok(Math.max(...completedKeyboard.actions.map(a=>a.started_at))<Math.min(...completedKeyboard.actions.map(a=>a.finished_at)));
  await stage('pages','三路输入结束，每个页面都有独立结果','逐页回读与计划一致；日志保留了每条动作的起止时间');await shot('demo-pages.png');await sleep(3200);

  await stage('document','已验证：文档、表单和多页面输入','4 路文档并发插入 · 20 个表单值正确 · 3 路独立键盘输入');await sleep(4000);
  const evidence={passed:true,plan,document_job:completedDoc,choice_job:choiceJob,field_job:fieldJob,keyboard_job:completedKeyboard,
    final_document:finalText,verification:{document_exact_match:true,form_choices:10,form_text_fields:10,keyboard_pages:3},
    disclosure:'The UI is a live synchronized viewer. Browser actions run in real isolated Playwright pages; document edits merge through Yjs replicas. pace_ms intentionally slows typing for readability; this recording is not a performance benchmark.'};
  await fs.writeFile(path.join(output,'demo-evidence.json'),JSON.stringify(evidence,null,2));
  await fs.writeFile(path.join(output,'mcp-transcript.json'),JSON.stringify(transcript,null,2));
  await post('/api/demo',{demonstration:'complete'});
  console.log(JSON.stringify({passed:true,output,document_peak:4,form_verified:20,keyboard_peak:3}));
}finally{
  if(recording){const video=await post('/api/record/stop');await fs.copyFile(video.path,path.join(output,'demo-recording.webm'));console.log(`VIDEO ${path.join(output,'demo-recording.webm')}`);}
  await client.close();
}
