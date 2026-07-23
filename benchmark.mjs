import { stat, readFile } from 'node:fs/promises';
import { openAsBlob } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { basename } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';

const FILE_SIZE = 40 * 1024 * 1024; // 40MB
const TEST_FILE = './test-large-file.bin';

// create dummy large file
const buffer = Buffer.alloc(FILE_SIZE, 'a');
writeFileSync(TEST_FILE, buffer);

async function testReadFile() {
  const start = performance.now();
  const form = new FormData();
  const stats = await stat(TEST_FILE);
  const data = await readFile(TEST_FILE);
  form.append('file', new Blob([data]), basename(TEST_FILE));
  return performance.now() - start;
}

async function testOpenAsBlob() {
  const start = performance.now();
  const form = new FormData();
  const stats = await stat(TEST_FILE);
  const blob = await openAsBlob(TEST_FILE);
  form.append('file', blob, basename(TEST_FILE));
  return performance.now() - start;
}

async function run() {
  console.log('Warming up...');
  await testReadFile();
  await testOpenAsBlob();

  console.log('Testing readFile...');
  let sum1 = 0;
  for(let i=0; i<10; i++) sum1 += await testReadFile();

  console.log('Testing openAsBlob...');
  let sum2 = 0;
  for(let i=0; i<10; i++) sum2 += await testOpenAsBlob();

  console.log(`readFile avg: ${sum1/10} ms`);
  console.log(`openAsBlob avg: ${sum2/10} ms`);

  unlinkSync(TEST_FILE);
}
run();
