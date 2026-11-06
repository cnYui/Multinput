import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function connect() {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/mcp-server.mjs')], stderr: 'inherit',
    env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) });
  const client = new Client({ name: 'codex-local-demonstration', version: '0.1.0' });
  await client.connect(transport); return client;
}
export async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content.map(c => c.text || '').join('\n'));
  return result.structuredContent || JSON.parse(result.content.find(c => c.type === 'text').text);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = await connect();
  try {
    const name = process.argv[2] || 'workspace_observe';
    console.log(JSON.stringify(name === 'tools/list' ? await client.listTools() : await call(client, name, JSON.parse(process.argv[3] || '{}')), null, 2));
  } finally { await client.close(); }
}
