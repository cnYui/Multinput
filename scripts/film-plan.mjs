export const text=[
 '示例项目发布方案','2026.11  /  创作者工具组','',
 '一、项目概述','定位：','',
 '二、核心能力','能力：','',
 '三、交互体验','体验：','',
 '四、实施计划','节奏：','',
 '五、验收标准','标准：'
].join('\n');
export const inserts=[
 '面向创作者，把想法、内容与交付放在同一个工作空间。',
 '一个 AI 编排多条输入通道，批量完成文档与表格任务。',
 '光标各自定位，输入错峰推进，操作之间不必逐次等待。',
 '先完成核心体验，再补齐模板、导出和团队协作能力。',
 '核对每项实际结果，确保文字、选项与插入位置正确。'
];
export const offsets=[0,180,430,95,310],paces=[95,80,105,87,97];
export const locks=[5,8,11,14,17].map((line,i)=>({id:`AI · 0${i+1}`,line}));
export const docActions=inserts.map((value,i)=>({id:`write-${i+1}`,op:'document_insert',document_id:'film-doc',cursor_id:locks[i].id,text:value,start_ms:offsets[i],pace_ms:paces[i]}));
export const records=[
 {owner:'林悦',status:'进行中',priority:0,scope:[0,1],date:'2026-11-09',hours:'8',note:'完成首屏版式与响应式视觉稿。'},
 {owner:'陈序',status:'待审核',priority:1,scope:[0,1],date:'2026-11-10',hours:'6',note:'统一产品叙事，补齐三组应用案例。'},
 {owner:'周宁',status:'进行中',priority:0,scope:[2,3],date:'2026-11-12',hours:'16',note:'打通注册流程并检查异常提示。'},
 {owner:'许禾',status:'待开始',priority:1,scope:[0,1],date:'2026-11-13',hours:'10',note:'准备录屏素材，完成节奏与镜头剪辑。'},
 {owner:'沈知',status:'进行中',priority:1,scope:[1,2],date:'2026-11-14',hours:'12',note:'适配手机布局，验证触控与输入体验。'},
 {owner:'顾言',status:'已完成',priority:2,scope:[2,3],date:'2026-11-16',hours:'4',note:'复核表单、链接、导出与最终交付。'}
];
export function changes(stagger=true){const rowOffsets=[0,170,390,650,870,1130];return records.flatMap((r,i)=>{
 const ref=`r${i+1}`,t=stagger?rowOffsets[i]:0,at=n=>stagger?t+n:0;
 return [
  {ref:`${ref}-owner`,op:'fill',value:r.owner,start_ms:at(0),typing_ms:stagger?60+i*7:0},
  {ref:`${ref}-note`,op:'fill',value:r.note,start_ms:at(55),typing_ms:stagger?30+i*3:0},
  {ref:`${ref}-priority-${r.priority}`,op:'set_checked',value:true,start_ms:at(205)},
  ...r.scope.map((s,j)=>({ref:`${ref}-scope-${s}`,op:'set_checked',value:true,start_ms:at(285+j*95)})),
  {ref:`${ref}-status`,op:'select_option',value:r.status,start_ms:at(440),preview_ms:stagger?420:0},
  {ref:`${ref}-date`,op:'fill',value:r.date,start_ms:at(665)},
  {ref:`${ref}-hours`,op:'fill',value:r.hours,start_ms:at(775)},
  {ref:`${ref}-confirm`,op:'set_checked',value:true,start_ms:at(1005)}
 ];
});}
