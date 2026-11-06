"""Cut the real white-scene capture into a 28-second music-led film.
Usage: python3 scripts/edit-film.py CAPTURE_DIR BGM_WAV OUTPUT_MP4
Requires ffmpeg/ffprobe. Card PNGs come from render-film-cards.mjs.
"""
import concurrent.futures
import json
import math
from pathlib import Path
import subprocess
import sys

capture=Path(sys.argv[1]).resolve();music=Path(sys.argv[2]).resolve();output=Path(sys.argv[3]).resolve()
edits=capture/'edit';edits.mkdir(exist_ok=True)
evidence=json.loads((capture/'film-evidence.json').read_text());m=evidence['markers'];raw=capture/'white-scenes.webm'
font='/System/Library/Fonts/STHeiti Medium.ttc'
if not Path(font).exists():font='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
assert Path(font).exists(),'Set a CJK font path in edit-film.py'

# duration is specified in 30-fps frames; cuts follow prominent attacks in the supplied BGM.
shots=[
 dict(name='intro',image='intro.png',frames=47,z=(1,1.018),center=(.5,.5,.5,.5)),
 dict(name='document-wide',start=m['ready']+.05,end=m['document_start']+.1,frames=88,z=(1,1.09),center=(.5,.49,.5,.49),title='一个 AI，自主分配输入位置',label='01  DOCUMENT'),
 dict(name='document-writing',start=m['document_start']+.1,end=m['document_start']+2.1,frames=91,z=(1.34,1.48),center=(.47,.49,.48,.51),title='5 个位置，错峰写入',label='ONE PLAN / FIVE INPUTS'),
 dict(name='document-lower',start=m['document_start']+2.1,end=m['document_done']+.1,frames=61,z=(1.5,1.56),center=(.47,.57,.49,.59),title='各自锁定位置，交错推进',label='STAGGERED INPUT'),
 dict(name='document-result',start=m['document_done']+.1,end=m['sheet_show']-.2,frames=63,z=(1.12,1.01),center=(.5,.5,.5,.5),title='完整文档，一次生成',label='COMPLETE'),
 dict(name='sheet-wide',start=m['sheet_show']+.08,end=m['sheet_start']-.04,frames=78,z=(1,1.08),center=(.5,.4,.5,.4),title='表格里的控件，也能一批完成',label='02  WORKSHEET'),
 dict(name='sheet-mixed',start=m['sheet_start']-.04,end=m['sheet_start']+.6,frames=33,z=(1.2,1.35),center=(.43,.4,.43,.4),title='输入与选择，交错进行',label='ONE BATCH'),
 dict(name='sheet-dropdown',start=m['sheet_start']+.6,end=m['sheet_start']+1.55,frames=33,z=(1.52,1.63),center=(.405,.4,.425,.415),title='单选 · 多选 · 下拉',label='MIXED CONTROLS'),
 dict(name='sheet-right',start=m['sheet_start']+1.55,end=m['sheet_done']+.15,frames=39,z=(1.53,1.62),center=(.62,.41,.66,.41),title='日期 · 数字 · 文本',label='ALL IN ONE BATCH'),
 dict(name='sheet-detail',start=m['sheet_done']+.15,end=m['sheet_done']+2.2,frames=90,z=(1.4,1.48),center=(.56,.405,.63,.405),title='54 项填写，全部完成',label='VERIFIED'),
 dict(name='sheet-result',start=m['sheet_done']+2.2,end=m['return_document']-.2,frames=106,z=(1.13,1),center=(.5,.42,.5,.5),title='一批答案，落到每个字段',label='COMPLETE'),
 dict(name='document-return',start=m['return_document']+.08,end=m['return_document']+2.2,frames=48,z=(1.05,1.1),center=(.5,.48,.5,.49),title='一个 AI，多个输入通道',label='MULTI INPUT'),
 dict(name='outro',image='outro.png',frames=63,z=(1,1.016),center=(.5,.5,.5,.5)),
]
assert sum(s['frames'] for s in shots)==840
timeline=0
for s in shots:s['timeline_start']=round(timeline/30,3);timeline+=s['frames']
(edits/'edit-plan.json').write_text(json.dumps({'duration':28,'fps':30,'shots':shots,'bgm_source_range':[0,30],'bgm_used_range':[0,28]},ensure_ascii=False,indent=2))

def q(text):return text.replace('\\','\\\\').replace(':','\\:').replace("'","\\'")
def render(index,s):
 dest=edits/f'{index:02d}-{s["name"]}.mp4';f=s['frames'];duration=f/30
 p=f'min(on/{max(f-1,1)},1)';ease=f'({p})*({p})*(3-2*({p}))'
 z0,z1=s['z'];cx0,cy0,cx1,cy1=s['center'];z=f'{z0}+({z1-z0})*({ease})'
 x=f'iw*({cx0}+({cx1-cx0})*({ease}))-iw/zoom/2';y=f'ih*({cy0}+({cy1-cy0})*({ease}))-ih/zoom/2'
 cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-threads','2']
 if 'image' in s:
  cmd+=['-loop','1','-framerate','30','-i',str(capture/s['image'])];prefix='fps=30'
 else:
  raw_duration=s['end']-s['start'];assert raw_duration>0
  cmd+=['-ss',str(s['start']),'-t',str(raw_duration),'-i',str(raw)]
  prefix=f'setpts={duration/raw_duration:.9f}*(PTS-STARTPTS),fps=30,tpad=stop_mode=clone:stop_duration=1'
 filters=prefix+f",zoompan=z='{z}':x='{x}':y='{y}':d=1:s=1920x1080:fps=30"
 if s.get('title'):
  filters+=",drawbox=x=60:y=914:w=1430:h=132:color=white@0.96:t=fill"
  filters+=f",drawtext=fontfile='{q(font)}':text='{q(s['label'])}':fontsize=17:fontcolor=0x4777a7:x=85:y=937"
  filters+=f",drawtext=fontfile='{q(font)}':text='{q(s['title'])}':fontsize=39:fontcolor=0x203447:x=84:y=974"
  filters+=f",drawtext=fontfile='{q(font)}':text='本地交互演示':fontsize=13:fontcolor=0x9ba7b0:x=w-tw-32:y=h-th-21:box=1:boxcolor=white@0.85:boxborderw=5"
 if s['name']=='outro':filters+=',fade=t=out:st=1.9:d=0.2:color=white'
 cmd+=['-vf',filters,'-filter_threads','1','-frames:v',str(f),'-an','-c:v','libx264','-preset','fast','-crf','17','-threads','2','-pix_fmt','yuv420p','-video_track_timescale','15360',str(dest)]
 result=subprocess.run(cmd,capture_output=True,text=True)
 if result.returncode:raise RuntimeError(f'{s["name"]}: {result.stderr[-3500:]}')
 print(f'Rendered {index+1:02d}/{len(shots)} {s["name"]}',flush=True);return dest

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 futures=[pool.submit(render,i,s) for i,s in enumerate(shots)]
 files=[f.result() for f in futures]
concat=edits/'concat.txt';concat.write_text(''.join("file '"+str(p).replace("'","'\\''")+"'\n" for p in files))
cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-i',str(music),'-map','0:v:0','-map','1:a:0','-c:v','copy','-af','volume=0.88,afade=t=in:st=0:d=0.06,afade=t=out:st=27.3:d=0.7','-c:a','aac','-b:a','192k','-t','28','-movflags','+faststart','-metadata','title=Multi Input — One AI, many inputs','-metadata','comment=BGM: user-provided 3 Strikes excerpt, Bilibili BV1NmzJB8EfE. Local Word/Sheets-style interactive demonstration.',str(output)]
subprocess.run(cmd,check=True)
print(json.dumps({'output':str(output),'duration':28,'shots':len(shots),'audio':True},ensure_ascii=False),flush=True)
