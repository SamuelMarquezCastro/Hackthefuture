// Publish an explicit selection of viewer assets; never copy the repository wholesale.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const trace = JSON.parse(readFileSync(join(root, 'trace.json'), 'utf8'));
const verdict = JSON.parse(readFileSync(join(root, 'verdict.json'), 'utf8'));
if (trace.status !== 'klaar' || !trace.run_id || trace.run_id !== verdict.run_id) {
  throw new Error('Publish only a completed trace and verdict with the same run_id.');
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
function copy(source, destination) {
  const target = join(output, destination);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, source), target);
}
copy('viewer.html', 'index.html');
copy('trace.json', 'trace.json');
copy('verdict.json', 'verdict.json');
const extensions = new Set(['.html', '.js', '.css', '.glb', '.png', '.txt']);
function copyAssets(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) copyAssets(path);
    else if (entry.isFile() && extensions.has(extname(entry.name))) copy(path, path);
  }
}
copyAssets('zaal');
console.log(`Static viewer built in dist/ for ${trace.run_id}`);
