const params=new URLSearchParams(location.search);if(params.has('capture'))document.body.classList.add('capture');
const colors=['#3578e5','#da6d42','#8f62c4','#279978','#d35d89','#c68b27'];let latest;
function word(doc){if(!doc)return;const fragment=document.createDocumentFragment();
 doc.lines.forEach((line,index)=>{const row=document.createElement('div');row.className='word-line '+(index===0?'title':index===1?'meta':line.text===''?'blank':/^[一二三四五]、/.test(line.text)?'heading':'body');
 const cursors=doc.cursors.filter(c=>c.lock&&c.head>=line.start&&c.head<=line.end).sort((a,b)=>a.head-b.head);let last=line.start;
 for(const c of cursors){row.append(document.createTextNode(doc.text.slice(last,c.head)));const caret=document.createElement('span');caret.className=`word-caret ${c.status}`;caret.style.setProperty('--c',colors[doc.cursors.findIndex(x=>x.id===c.id)%colors.length]);caret.dataset.name=c.id;row.append(caret);last=c.head;}
 row.append(document.createTextNode(doc.text.slice(last,line.end)||' '));fragment.append(row);});document.getElementById('word-content').replaceChildren(fragment);
 document.getElementById('word-count').textContent=`${doc.text.replace(/\s/g,'').length} 字`;
 const active=doc.cursors.filter(c=>c.status==='writing').length,done=doc.cursors.filter(c=>c.status==='done').length;
 document.getElementById('dock-title').textContent=active?'同一个 AI，多处同时写入':done?'全部内容已完成':'一次生成完整修改计划';
 document.getElementById('dock-detail').textContent=active?`${active} 处正在输入 · 各自锁定插入位置`:done?`${done} 处修改完成 · 内容与位置已核对`:'根据内容，自主选择输入位置';
 document.getElementById('dock-cursors').replaceChildren(...doc.cursors.map((c,i)=>{const dot=document.createElement('span');dot.className=`dock-dot ${c.status}`;dot.style.setProperty('--c',colors[i%colors.length]);return dot;}));
}
const ws=new WebSocket(`ws://${location.host}/events`);ws.onmessage=e=>{latest=JSON.parse(e.data);document.getElementById('word-scene').hidden=latest.stage==='sheet';document.getElementById('sheet-scene').hidden=latest.stage!=='sheet';word(latest.documents.find(d=>d.id==='film-doc')||latest.documents.at(-1));window.__ready=true;};
