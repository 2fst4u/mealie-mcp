const { performance } = require('perf_hooks');

const content = 'image/jpeg; charset=utf-8';

function testOriginal() {
  return content.split(";")[0];
}

function testIndex() {
  const index = content.indexOf(';');
  return index === -1 ? content : content.slice(0, index);
}

function run() {
  const N = 1000000;
  let start = performance.now();
  for (let i = 0; i < N; i++) testOriginal();
  console.log('original:', performance.now() - start);

  start = performance.now();
  for (let i = 0; i < N; i++) testIndex();
  console.log('index:', performance.now() - start);
}
run();
