let current, manual = false, localStage = null;
const $ = id => document.getElementById(id);
const statusText = { locked:'已锁定', writing:'写入中', running:'执行中', done:'已完成', queued:'排队中', released:'已释放', cancelled:'已取消', failed:'失败' };
const palette = ['#66e0c2','#f7bb72','#a9a0ff','#ff8fa8','#83c8ff','#d9dc79','#e3a4f4','#8de3a8','#ffae8c','#b7c5ff'];
function renderDocument(d) {
  if (!d) { $('document-editor').textContent = '等待 document_create…'; return; }
  $('doc-revision').textContent = `REV ${d.revision}`;
  if (manual) return;
  const fragment = document.createDocumentFragment();
  for (const line of d.lines) {
    const row = document.createElement('div'); row.className = 'doc-line';
    const owners = d.cursors.filter(c => c.lock && c.from <= line.end && c.to >= line.start);
    if (owners.length) { row.classList.add('leased'); row.style.setProperty('--cursor', owners[0].color); }
    const num = document.createElement('span'); num.className = 'line-num'; num.textContent = String(line.line).padStart(2,'0'); row.append(num);
    const body = document.createElement('span'); body.className = 'line-body';
    const heads = d.cursors.filter(c => c.head >= line.start && c.head <= line.end && c.lock).sort((a,b) => a.head-b.head);
    let last = line.start;
    for (const c of heads) {
      body.append(document.createTextNode(d.text.slice(last, c.head)));
      const caret = document.createElement('span'); caret.className = `caret ${c.status}`; caret.style.setProperty('--cursor',c.color);
      const label = document.createElement('span'); label.className = 'caret-label'; label.textContent = c.id; caret.append(label); body.append(caret); last=c.head;
    }
    body.append(document.createTextNode(d.text.slice(last,line.end) || (line.text ? '' : ' ')));row.append(body);fragment.append(row);
  }
  const editor=$('document-editor'), scroll=editor.scrollTop;editor.replaceChildren(fragment);editor.scrollTop=scroll;
}
function render(s) {
  current=s; window.__ready=true;
  const stage=localStage||s.stage;
  $('headline').textContent=s.headline;$('subtitle').textContent=s.subtitle;
  for (const p of ['document','form','pages']) $(p+'-panel').hidden=p!==stage;
  document.querySelectorAll('[data-stage]').forEach(b=>b.classList.toggle('selected',b.dataset.stage===stage));
  const jobs=s.jobs, doc=s.documents.at(-1);
  const job=jobs.filter(j=>j.actions.some(a=>stage==='document'?a.op==='document_insert':stage==='form'?a.page_id==='form':['research','outline','checklist'].includes(a.page_id))).at(-1);
  let channels=[];
  if(stage==='document') channels=(doc?.cursors||[]).map(c=>({id:c.id,status:c.status,color:c.color}));
  else if(stage==='form')channels=(s.surfaceCursors.form||[]).map((c,i)=>({id:c.label||c.ref,status:c.status,color:palette[i%10]}));
  else channels=['research','outline','checklist'].map((id,i)=>({id:`页面 ${String.fromCharCode(65+i)}`,color:palette[i],status:s.surfaceCursors[id]?.[0]?.status||'queued'}));
  $('channels').replaceChildren(...channels.slice(0,10).map(c=>{const e=document.createElement('div');e.className='channel';e.style.setProperty('--cursor',c.color);const dot=document.createElement('span');dot.className='dot';const b=document.createElement('b');b.textContent=c.id;const st=document.createElement('small');st.textContent=statusText[c.status]||c.status;e.append(dot,b,st);return e;}));
  $('channels').style.gridTemplateColumns=stage==='form'?'repeat(5,1fr)':'repeat(3,1fr)';
  $('channel-count').textContent=channels.length;
  const form=s.forms.form||{}, values=Object.keys(form), chosen=values.filter(k=>/^q\d+$/.test(k)&&form[k]).length, filled=values.filter(k=>/^note\d+$/.test(k)&&form[k]).length;
  const formVerified=new Set(jobs.flatMap(j=>j.actions.filter(a=>a.page_id==='form'&&a.status==='done').flatMap(a=>a.result?.targets?.filter(t=>t.verified).map(t=>t.ref)||[]))).size;
  const verified=stage==='form'?formVerified:stage==='document'?(doc?.cursors.filter(c=>c.inserted&&['done','released'].includes(c.status)).length||0):(job?.actions.filter(a=>a.status==='done'&&a.result?.verified).length||0);
  $('metric-lanes').textContent=channels.length;$('metric-active').textContent=jobs.reduce((n,j)=>n+j.active,0);$('metric-verified').textContent=verified;
  $('metric-lanes-note').textContent=stage==='document'?'独立锚点 / 范围锁':stage==='form'?'独立字段 / 单次批量调用':'独立浏览器上下文';
  $('metric-mode').textContent=stage==='document'?'并发插入':stage==='form'?'批量填写':'并行键盘输入';
  $('metric-mode-note').textContent=stage==='document'?'每通道一个 Yjs 副本':stage==='form'?'一批操作 / 统一验证':'不同页面 / 焦点隔离';
  $('metric-verified-note').textContent=stage==='form'?`${chosen}/10 选择 · ${filled}/10 文本`:stage==='document'?'插入文本已合并回读':'字段值已逐页回读';
  $('panel-title').textContent=stage==='document'?`文档 / ${doc?.title||'concurrent-notes.txt'}`:stage==='form'?'表单 / 10 个独立问题':'浏览器 / 3 个独立页面';
  $('panel-status').textContent=job?`${statusText[job.status]||job.status} · PEAK ${job.peak_active} · JOB ${job.id}`:'等待 MCP 操作';
  renderDocument(doc);
  $('trace').replaceChildren(...s.events.slice(-3).reverse().map(e=>{const row=document.createElement('div');row.className='trace-row';const t=document.createElement('time');t.textContent=new Date(e.at).toLocaleTimeString('zh-CN',{hour12:false});const b=document.createElement('b');b.textContent=e.type;const detail=document.createElement('span');detail.textContent=e.detail;row.append(t,b,detail);return row;}));
  $('clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false});
}
document.querySelectorAll('[data-stage]').forEach(b=>b.onclick=()=>{localStage=b.dataset.stage;render(current)});
$('manual-edit').onclick=async()=>{
  const d=current?.documents.at(-1);if(!d)return;
  if(d.cursors.some(c=>c.lock)){alert('请先通过 cursor_release 释放范围锁，再手动编辑。');return;}
  if(!manual){manual=true;$('manual-text').value=d.text;$('manual-text').hidden=false;$('document-editor').hidden=true;$('manual-edit').textContent='保存';}
  else{const r=await fetch('/api/document',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:d.id,text:$('manual-text').value,revision:d.revision})});const out=await r.json();if(out.error){alert(out.error);return;}manual=false;$('manual-text').hidden=true;$('document-editor').hidden=false;$('manual-edit').textContent='手动编辑';}
};
function connect(){const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/events`);ws.onopen=()=>{$('connection').textContent='本地执行器已连接'};ws.onmessage=e=>render(JSON.parse(e.data));ws.onclose=()=>{$('connection').textContent='连接已断开';setTimeout(connect,1500)};}connect();
