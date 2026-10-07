// Copies the web app into www/ for Capacitor. The list is explicit on purpose: the project folder
// also holds private pictures (local/, _local*/) that must never end up in the APK.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(app, '..');
const www = join(app, 'www');
const files = ['index.html', 'style.css', 'LICENSE', 'src', 'vendor', 'demo'];

rmSync(www, { recursive: true, force: true });
mkdirSync(www);
for (const f of files) {
  const from = join(root, f);
  if (!existsSync(from)) throw new Error(`missing ${f}`);
  cpSync(from, join(www, f), { recursive: true, filter: (p) => !/(^|[\\/])(local|_local[^\\/]*)([\\/]|$)/.test(p.slice(root.length)) });
}
console.log(`web files copied to ${www}: ${files.join(', ')}`);
