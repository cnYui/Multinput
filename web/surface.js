const params=new URLSearchParams(location.search), surfaceId=params.get('id')||'form', kind=document.body.dataset.kind, observer=params.get('observer')==='1';
const palette=['#66e0c2','#f7bb72','#a9a0ff','#ff8fa8','#83c8ff','#d9dc79','#e3a4f4','#8de3a8','#ffae8c','#b7c5ff'];
if(!observer){document.addEventListener('input',changed);document.addEventListener('change',changed);}
else for(const el of document.querySelectorAll('input,textarea')){if(el.type==='radio')el.disabled=true;else el.readOnly=true;}
let surfaceTimer;
function changed(){clearTimeout(surfaceTimer);surfaceTimer=setTimeout(async()=>{
 const values={};if(kind==='form'){for(const el of document.querySelectorAll('input')){if(el.type==='radio'){if(el.checked)values[el.name]=el.value;}else values[el.name]=el.value;}}
 else values.input=document.getElementById('task-input').value;
 await fetch('/api/surface',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:surfaceId,kind,values})});
},15);}
function render(s){
 if(kind==='form'){
  const values=s.forms[surfaceId]||{};
  if(observer)for(const el of document.querySelectorAll('input')){if(el.type==='radio'){if(values[el.name]!==undefined)el.checked=values[el.name]===el.value;}else if(values[el.name]!==undefined)el.value=values[el.name];}
  const n=Object.values(values).filter(Boolean).length;document.getElementById('summary').textContent=`${n} / 20 已填写`;
 }else{const v=s.tasks[surfaceId]?.input||'',el=document.getElementById('task-input');if(observer)el.value=v;document.getElementById('task-status').textContent=v?`实际输入 ${[...v].length} 个字符`:'等待输入';}
 const cursors=s.surfaceCursors[surfaceId]||[];const frag=document.createDocumentFragment();
 cursors.forEach((c,i)=>{const target=document.getElementById(c.ref)||document.querySelector(`[data-mi-ref="${CSS.escape(c.ref)}"]`);if(!target)return;const r=target.getBoundingClientRect();const cursor=document.createElement('div');cursor.className=`mi-cursor ${c.status}`;cursor.style.cssText=`--c:${palette[i%10]};left:${r.x+r.width*.55+window.scrollX}px;top:${r.y+r.height*.45+window.scrollY}px`;const arrow=document.createElement('span');arrow.className='mi-arrow';arrow.textContent='➤';const tag=document.createElement('span');tag.className='mi-tag';tag.textContent=c.status==='done'?'✓':String(i+1).padStart(2,'0');cursor.append(arrow,tag);frag.append(cursor);});
 document.getElementById('overlays').replaceChildren(frag);
}
function connect(){const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/events`);ws.onmessage=e=>render(JSON.parse(e.data));ws.onclose=()=>setTimeout(connect,1500);}connect();
