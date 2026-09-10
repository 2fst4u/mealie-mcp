const { performance } = require('perf_hooks');

const from = Array.from({length: 1000}, (_, i) => ({ category: `cat_${i % 50}` }));
const kept = new Set(Array.from({length: 25}, (_, i) => `cat_${i}`));

function testOriginal() {
  const counts = new Map();
  for (const t of from) {
    if (!kept.has(t.category)) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName))
    .map(([name]) => name);
}

function testOptimized() {
  const counts = new Map();
  for (let i = 0; i < from.length; i++) {
    const cat = from[i].category;
    if (!kept.has(cat)) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  const entries = [...counts.entries()];
  entries.sort(([aName, aCount], [bName, bCount]) => bCount - aCount || aName.localeCompare(bName));
  const result = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) result[i] = entries[i][0];
  return result;
}

function run() {
  const N = 10000;
  let start = performance.now();
  for (let i = 0; i < N; i++) testOriginal();
  console.log('original:', performance.now() - start);

  start = performance.now();
  for (let i = 0; i < N; i++) testOptimized();
  console.log('optimized:', performance.now() - start);
}
run();
