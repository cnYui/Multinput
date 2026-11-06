import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { connect,call,post,waitJob,sleep,base } from './session.mjs';
import { text,locks,docActions,inserts,changes } from './film-plan.mjs';
const out=path.resolve(process.argv[2]||'.runtime/film');await fs.mkdir(out,{recursive:true});
const client=await connect(),transcript=[],markers={};let browser,context,page,video,zero;
const invoke=async(name,args)=>{const result=await call(client,name,args);transcript.push({tool:name,arguments:args,result,at_ms:zero?Date.now()-zero:null});return result;};
const mark=name=>{markers[name]=(Date.now()-zero)/1000;};
const shot=async name=>page.screenshot({path:path.join(out,name)});
try{
 await invoke('workspace_observe',{page_ids:[]});await post('/api/reset');
 await invoke('document_create',{id:'film-doc',title:'产品发布方案.md',text});
 await invoke('page_open',{id:'sheet',url:`${base}/sheet`});await invoke('workspace_observe',{page_ids:['sheet']});
 await post('/api/demo',{stage:'document'});
 browser=await chromium.launch({headless:true});context=await browser.newContext({viewport:{width:3840,height:2160},deviceScaleFactor:1,recordVideo:{dir:path.join(out,'capture'),size:{width:3840,height:2160}},locale:'zh-CN'});
 zero=Date.now();page=await context.newPage();video=page.video();await page.goto(`${base}/film?capture=1`);await page.waitForFunction(()=>window.__ready);mark('ready');
 await sleep(2100);await invoke('cursor_lock',{document_id:'film-doc',cursors:locks});mark('locked');await sleep(950);
 mark('document_start');const docJob=await invoke('execute_batch',{parallelism:5,actions:docActions});await sleep(1100);await shot('white-document-writing.png');
 const docDone=await waitJob(client,docJob);assert.equal(docDone.status,'done');assert.equal(docDone.peak_active,5);mark('document_done');
 const observed=await invoke('workspace_observe',{page_ids:[]});const actual=observed.documents.find(d=>d.id==='film-doc').text;
 const labels=['定位：','能力：','体验：','节奏：','标准：'];let expected=text;labels.forEach((l,i)=>expected=expected.replace(l,l+inserts[i]));assert.equal(actual,expected);
 const saved=await invoke('document_save',{document_id:'film-doc',filename:'产品发布方案.md'});await fs.copyFile(saved.path,path.join(out,'产品发布方案.md'));
 await shot('white-document-complete.png');await sleep(2600);
 await post('/api/demo',{stage:'sheet'});mark('sheet_show');await sleep(1900);await shot('white-sheet-before.png');
 mark('sheet_start');const sheetJob=await invoke('execute_batch',{parallelism:1,actions:[{id:'all-six-records',op:'form_patch',page_id:'sheet',changes:changes(true)}]});
 await sleep(650);await shot('white-sheet-writing.png');
 const sheetDone=await waitJob(client,sheetJob);assert.equal(sheetDone.status,'done');assert.equal(sheetDone.actions[0].result.targets.filter(x=>x.verified).length,54);mark('sheet_done');
 await invoke('workspace_observe',{page_ids:['sheet']});await sleep(200);await shot('white-sheet-complete.png');await sleep(5200);
 await post('/api/demo',{stage:'document'});mark('return_document');await sleep(3000);mark('end');
 await fs.writeFile(path.join(out,'film-evidence.json'),JSON.stringify({passed:true,markers,document_job:docDone,sheet_job:sheetDone,document_exact_match:actual===expected,fields_verified:54,staggered:true,simulation:'Local Word/Sheets-style interactive surfaces, not Microsoft Word or Google Sheets integrations.'},null,2));
 await fs.writeFile(path.join(out,'film-mcp-transcript.json'),JSON.stringify(transcript,null,2));
}finally{
 if(context){await context.close();await fs.copyFile(await video.path(),path.join(out,'white-scenes.webm'));}
 await browser?.close();await client.close();
}
console.log(JSON.stringify({out,markers}));
