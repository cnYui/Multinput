import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { connect,call,post,waitJob,base } from './session.mjs';
import { changes,records } from './film-plan.mjs';
const client=await connect();const report={passed:false,checks:[]};
try{
 await call(client,'workspace_observe',{page_ids:[]});await post('/api/reset');
 await call(client,'page_open',{id:'sheet',url:`${base}/sheet?test=1`});
 const before=await call(client,'workspace_observe',{page_ids:['sheet']});
 const select=before.pages[0].elements.find(e=>e.ref==='r1-status');assert.equal(select.options.length,5);assert.ok(select.options.some(o=>o.value==='进行中'));
 report.checks.push('Select option labels and values are available in observation');
 const job=await waitJob(client,await call(client,'execute_batch',{parallelism:1,actions:[{id:'mixed',op:'form_patch',page_id:'sheet',changes:changes(true)}]}));
 assert.equal(job.status,'done');assert.equal(job.actions[0].result.targets.length,54);assert.ok(job.actions[0].result.targets.every(x=>x.verified));
 report.checks.push('54 staggered edits: text, radio, checkboxes, dropdowns, dates and numbers verified');
 const result=await call(client,'workspace_observe',{page_ids:['sheet']});const fields=result.pages[0].elements;
 for(let i=0;i<6;i++){const r=i+1;assert.equal(fields.find(e=>e.ref===`r${r}-owner`).value,records[i].owner);assert.equal(fields.find(e=>e.ref===`r${r}-status`).value,records[i].status);assert.equal(fields.find(e=>e.ref===`r${r}-date`).value,records[i].date);assert.equal(fields.find(e=>e.ref===`r${r}-hours`).value,records[i].hours);assert.equal(fields.find(e=>e.ref===`r${r}-note`).value,records[i].note);}
 report.checks.push('Final browser DOM values match the planned six records');
 const multi=await waitJob(client,await call(client,'execute_batch',{actions:[{id:'multi',op:'form_patch',page_id:'sheet',changes:[{ref:'multi-test',op:'select_option',value:['alpha','gamma']}]}]}));
 assert.equal(multi.status,'done');assert.deepEqual(multi.actions[0].result.targets[0].actual,['alpha','gamma']);
 report.checks.push('Native select-multiple accepts and verifies an array of selected values');
 const invalid=await waitJob(client,await call(client,'execute_batch',{actions:[{id:'invalid',op:'form_patch',page_id:'sheet',changes:[{ref:'r1-owner',op:'fill',value:'MUST NOT APPLY'},{ref:'r1-status',op:'select_option',value:'不存在'}]}]}));
 assert.equal(invalid.status,'failed');const after=await call(client,'workspace_observe',{page_ids:['sheet']});assert.equal(after.pages[0].elements.find(e=>e.ref==='r1-owner').value,records[0].owner);
 report.checks.push('Unknown dropdown value fails preflight without modifying earlier fields');
 report.passed=true;report.job=job;
}finally{await fs.mkdir('demo-results',{recursive:true});await fs.writeFile('demo-results/mixed-e2e-report.json',JSON.stringify(report,null,2));await client.close();}
console.log(JSON.stringify({passed:report.passed,checks:report.checks},null,2));
