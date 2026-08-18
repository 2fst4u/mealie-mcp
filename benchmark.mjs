import { performance } from 'perf_hooks';
import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';

const iters = 1000;

const startSync = performance.now();
for (let i = 0; i < iters; i++) {
  JSON.parse(readFileSync('package.json', 'utf8')).version ?? '0.0.0';
}
const endSync = performance.now();

const startAsync = performance.now();
for (let i = 0; i < iters; i++) {
  JSON.parse(await readFile('package.json', 'utf8')).version ?? '0.0.0';
}
const endAsync = performance.now();

console.log(`Sync: ${endSync - startSync}ms`);
console.log(`Async: ${endAsync - startAsync}ms`);
