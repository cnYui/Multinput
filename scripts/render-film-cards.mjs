import fs from 'node:fs/promises';import path from 'node:path';import {chromium} from 'playwright';import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(process.argv[2]||'.runtime/film');await fs.mkdir(out,{recursive:true});
const b=await chromium.launch({headless:true});const p=await b.newPage({viewport:{width:3840,height:2160},deviceScaleFactor:1});
await p.setContent(await fs.readFile(path.join(root,'web/film-card.html'),'utf8'));await p.screenshot({path:path.join(out,'intro.png')});await p.evaluate(()=>window.setCard('outro'));await p.screenshot({path:path.join(out,'outro.png')});await b.close();console.log(out);
