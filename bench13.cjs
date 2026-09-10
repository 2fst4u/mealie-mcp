const { performance } = require('perf_hooks');

const value = "recipe,households_mealplans,households_shopping_lists,   admin   ,  test_test,       ";

function testOriginal() {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function testLoop2() {
  const parts = value.split(",");
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim();
    if (trimmed) result.push(trimmed);
  }
  return result;
}

function run() {
  const N = 1000000;
  let start = performance.now();
  for (let i = 0; i < N; i++) testOriginal();
  console.log('original:', performance.now() - start);

  start = performance.now();
  for (let i = 0; i < N; i++) testLoop2();
  console.log('loop2:', performance.now() - start);
}
run();
