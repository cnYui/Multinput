import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=path.join(root,'src/mcp-server.mjs');
const skillSource=path.join(root,'skill/multi-input');
const skillTarget=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'skills/multi-input');
const get=spawnSync('codex',['mcp','get','multi-input','--json'],{encoding:'utf8'});
if(get.error)throw get.error;
if(get.status===0){
 const existing=JSON.parse(get.stdout),transport=existing.transport||existing;
 if(!transport.args?.includes(server))throw new Error('An unrelated MCP server named multi-input already exists. Choose another name rather than overwriting it.');
}else{
 const add=spawnSync('codex',['mcp','add','multi-input','--',process.execPath,server],{encoding:'utf8'});
 if(add.status!==0)throw new Error(add.stderr||'Could not register MCP server.');
 console.log(add.stdout.trim());
}
try{
 const previous=await fs.readFile(path.join(skillTarget,'SKILL.md'),'utf8');
 const expected=await fs.readFile(path.join(skillSource,'SKILL.md'),'utf8');
 if(previous!==expected)throw new Error('An existing multi-input Skill differs from this package; it was not overwritten.');
}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(path.dirname(skillTarget),{recursive:true});await fs.cp(skillSource,skillTarget,{recursive:true});
console.log(`Installed Skill: ${skillTarget}`);
console.log('Start a new Codex chat/session to load the MCP tools and Skill.');
