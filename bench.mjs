import { performance } from 'perf_hooks';

function listOldMock(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function listNew(value) {
  if (!value) return [];
  const parts = value.split(",");
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    if (trimmed) {
      result.push(trimmed);
    }
  }
  return result;
}

function listNewForOf(value) {
  if (!value) return [];
  const parts = value.split(",");
  const result = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) {
      result.push(trimmed);
    }
  }
  return result;
}

const testStrings = [
  "",
  "a, b, c",
  "  foo,bar  ,  baz ",
  "1,2,3,4,5,6,7,8,9,10, ,  ,, 11",
  "only_one"
];

const iterations = 1000000;

function runBench(name, fn) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    for (const str of testStrings) {
      fn(str);
    }
  }
  const end = performance.now();
  console.log(`${name}: ${end - start} ms`);
}

runBench('old', listOldMock);
runBench('new', listNew);
runBench('newForOf', listNewForOf);
runBench('old', listOldMock);
runBench('new', listNew);
runBench('newForOf', listNewForOf);
