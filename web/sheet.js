const params=new URLSearchParams(location.search),observer=params.get('observer')==='1';
const tasks=['官网首屏视觉','产品介绍文案','注册流程开发','演示视频剪辑','移动端适配','上线前验收'];
const headers=['交付项目','负责人','交付状态','优先级（单选）','任务范围（多选）','已确认','截止日期','工时 / h','执行备注'];
const grid=document.getElementById('grid');
const cell=(html,cls='')=>`<div class="cell ${cls}">${html}</div>`;
grid.innerHTML=`<div class="row letters">${['',...'ABCDEFGHI'].map(x=>cell(x)).join('')}</div><div class="row headings">${cell('1','rownum')}${headers.map(x=>cell(x)).join('')}</div>`+tasks.map((task,i)=>{
 const r=i+1;return `<div class="row data-row" data-row="${r}">${cell(String(r+1),'rownum')}${cell(task,'task-name')}
 ${cell(`<input type="text" id="r${r}-owner" aria-label="${task}负责人" placeholder="填写姓名">`)}
 ${cell(`<select id="r${r}-status" aria-label="${task}交付状态"><option value="">选择状态</option><option value="待开始">待开始</option><option value="进行中">进行中</option><option value="待审核">待审核</option><option value="已完成">已完成</option></select>`)}
 ${cell(`<div class="radios">${['高','中','低'].map((x,j)=>`<label><input type="radio" id="r${r}-priority-${j}" name="r${r}-priority" value="${x}" aria-label="${task}优先级${x}">${x}</label>`).join('')}</div>`)}
 ${cell(`<div class="checks">${['文案','设计','开发','测试'].map((x,j)=>`<label><input type="checkbox" id="r${r}-scope-${j}" aria-label="${task}包含${x}">${x}</label>`).join('')}</div>`)}
 ${cell(`<input type="checkbox" id="r${r}-confirm" aria-label="${task}已确认">`)}
 ${cell(`<input type="date" id="r${r}-date" aria-label="${task}截止日期">`)}
 ${cell(`<input type="number" id="r${r}-hours" min="0" aria-label="${task}预计工时" placeholder="—">`)}
 ${cell(`<input type="text" id="r${r}-note" aria-label="${task}执行备注" placeholder="填写说明">`)}</div>`;
}).join('')+Array.from({length:10},(_,i)=>`<div class="row blank">${cell(String(i+8),'rownum')}${Array.from({length:9},()=>cell('')).join('')}</div>`).join('');
if(params.has('test')){const select=document.createElement('select');select.id='multi-test';select.multiple=true;select.innerHTML='<option value="alpha">Alpha</option><option value="beta">Beta</option><option value="gamma">Gamma</option>';select.style.cssText='position:absolute;left:50px;top:800px;width:160px;height:90px';document.body.append(select);}
const phases={};let timer;
function values(){const result={};for(const el of document.querySelectorAll('input,select'))result[el.id]=['radio','checkbox'].includes(el.type)?el.checked:el.tagName==='SELECT'&&el.multiple?[...el.selectedOptions].map(o=>o.value):el.value;return result;}
function publish(){if(timer)return;timer=setTimeout(async()=>{timer=null;await fetch('/api/surface',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'form',id:'sheet',values:{...values(),_phases:phases}})});},25);}
if(!observer){document.addEventListener('input',publish);document.addEventListener('change',publish);document.addEventListener('mi:phase',e=>{phases[e.detail.ref]=e.detail;e.target.classList.toggle('cell-writing',e.detail.phase==='active');publish();});}
else for(const el of document.querySelectorAll('input,select')){el.tabIndex=-1;el.style.pointerEvents='none';if(['text','date','number'].includes(el.type))el.readOnly=true;}
const palette=['#3578e5','#da6d42','#8f62c4','#279978','#d35d89','#b88a23'];let previous={};
function render(s){const data=s.forms.sheet||{},phaseList=Object.values(data._phases||{});
 if(observer)for(const el of document.querySelectorAll('input,select')){
  if(!(el.id in data))continue;const v=data[el.id];
  const before=['checkbox','radio'].includes(el.type)?el.checked:el.value;
  if(['checkbox','radio'].includes(el.type))el.checked=!!v;else if(el.multiple)for(const o of el.options)o.selected=v.includes(o.value);else el.value=v;
  if(el.tagName==='SELECT')el.classList.toggle('filled',!!el.value);
  const active=phaseList.some(p=>p.ref===el.id&&p.phase==='active');el.classList.toggle('cell-writing',active);
  if(before!==v&&previous[el.id]!==undefined){const parent=el.closest('.cell');if(parent){parent.classList.remove('flash');void parent.offsetWidth;parent.classList.add('flash');}}
 }
 previous={...data};
 const frag=document.createDocumentFragment();
 for(let row=1;row<=6;row++){
  const group=phaseList.filter(p=>p.ref.startsWith(`r${row}-`));const active=group.filter(p=>p.phase==='active').sort((a,b)=>b.at-a.at)[0];const selected=active||group.sort((a,b)=>b.at-a.at)[0];
  if(!selected)continue;const target=document.getElementById(selected.ref);if(!target)continue;const rect=target.getBoundingClientRect(),box=target.closest('.cell').getBoundingClientRect(),color=palette[row-1];
  const ring=document.createElement('div');ring.className='selection-ring';ring.style.cssText=`--c:${color};left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px`;frag.append(ring);
  const cur=document.createElement('div');cur.className='cursor';cur.style.cssText=`--c:${color};left:${rect.x+Math.min(rect.width*.65,100)}px;top:${rect.y+rect.height*.6}px`;cur.innerHTML=`<svg viewBox="0 0 20 25"><path d="M2 1L2 20L7 15L11 24L15 22L11 14L18 14Z" fill="${color}" stroke="white" stroke-width="1.4"/></svg><span>AI · 0${row}</span>`;frag.append(cur);
 }
 const open=phaseList.filter(p=>p.phase==='active'&&p.op==='select_option').sort((a,b)=>b.at-a.at)[0];
 if(open){const el=document.getElementById(open.ref);if(el){const r=el.getBoundingClientRect(),menu=document.createElement('div');menu.className='select-popover';menu.style.left=r.x+'px';menu.style.top=(r.bottom+4)+'px';menu.style.width=r.width+'px';for(const o of [...el.options].filter(o=>o.value)){const item=document.createElement('div');item.textContent=o.text;menu.append(item);}frag.append(menu);}}
 document.getElementById('overlays').replaceChildren(frag);
 const batch=s.jobs.filter(j=>j.actions.some(a=>a.page_id==='sheet')).at(-1);const count=batch?.actions.flatMap(a=>a.result?.targets||[]).filter(x=>x.verified).length||0;
 document.getElementById('batch-title').textContent=batch?.status==='running'?'一批答案，错峰填写所有控件':count?`${count} 项填写完成，全部核对一致`:'答案已生成，准备一次下发';
 document.getElementById('batch-detail').textContent=batch?.status==='running'?'文本与选择穿插执行 · 无需逐项等待 AI':count?'单选 · 多选 · 下拉 · 日期 · 数字 · 文本':'文本 · 单选 · 多选 · 下拉 · 日期 · 数字';
 window.__ready=true;
}
const ws=new WebSocket(`ws://${location.host}/events`);ws.onmessage=e=>render(JSON.parse(e.data));
