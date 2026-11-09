// Run from this project to create/reapply the administrator password.
// Credentials never appear in command arguments, browser assets, or console output.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.local');
const credentialFile = path.join(directory, 'admin-access.json');
await mkdir(directory, { recursive: true });
let credentials;
try { credentials = JSON.parse(await readFile(credentialFile, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  credentials = { url: 'https://podeumgo.podeumgo.workers.dev/admin', password: randomBytes(24).toString('base64url'), createdAt: new Date().toISOString() };
  await writeFile(credentialFile, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}
if (typeof credentials.password !== 'string' || credentials.password.length < 24) throw new Error('Invalid local administrator credential.');
const child = spawn(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'secret', 'put', 'ADMIN_PASSWORD'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', data => { output += data; });
child.stderr.on('data', data => { output += data; });
child.stdin.end(`${credentials.password}\n`);
const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
process.stdout.write(output.replaceAll(credentials.password, '[redacted]'));
if (result !== 0) process.exitCode = result || 1;
else console.log(`Administrator credential saved locally: ${credentialFile}`);
