// Register multi-input with Claude Code (user scope) and install the Skill into ~/.claude/skills.
// MULTI_INPUT_* variables set when running this script are stored in the MCP config, e.g.
//   MULTI_INPUT_USER_DATA_DIR=~/.multi-input/chrome-profile MULTI_INPUT_HEADLESS=0 MULTI_INPUT_CHANNEL=chrome npm run install:claude
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'src/mcp-server.mjs');
const env = Object.entries(process.env).filter(([k]) => k.startsWith('MULTI_INPUT_')).flatMap(([k, v]) => ['-e', `${k}=${v.replace(/^~(?=\/)/, os.homedir())}`]);
const get = spawnSync('claude', ['mcp', 'get', 'multi-input'], { encoding: 'utf8' });
if (get.error) throw new Error('Claude Code CLI (claude) was not found on PATH.');
if (get.status === 0) {
  if (!get.stdout.includes(server)) throw new Error('An unrelated MCP server named multi-input already exists. Remove it or choose another name.');
  console.log('multi-input is already registered; run `claude mcp remove multi-input -s user` first to change its settings.');
} else {
  const add = spawnSync('claude', ['mcp', 'add', 'multi-input', '-s', 'user', ...env, '--', process.execPath, server], { encoding: 'utf8' });
  if (add.status !== 0) throw new Error(add.stderr || 'Could not register MCP server.');
  console.log(add.stdout.trim());
}
const skillTarget = path.join(os.homedir(), '.claude', 'skills', 'multi-input');
try {
  const previous = await fs.readFile(path.join(skillTarget, 'SKILL.md'), 'utf8');
  if (previous !== await fs.readFile(path.join(root, 'skill/multi-input/SKILL.md'), 'utf8')) throw new Error('An existing multi-input Skill differs from this package; it was not overwritten.');
} catch (e) { if (e.code !== 'ENOENT') throw e; }
await fs.mkdir(path.dirname(skillTarget), { recursive: true });
await fs.cp(path.join(root, 'skill/multi-input'), skillTarget, { recursive: true });
console.log(`Installed Skill: ${skillTarget}\nStart a new Claude Code session to load the tools.`);
