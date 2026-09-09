const { performance } = require('perf_hooks');

const value = "recipe,households_mealplans,households_shopping_lists,   admin   ,  test_test,       ";

function testOriginal() {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function testLoop() {
  const result = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === ',') {
      current = current.trim();
      if (current) result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  current = current.trim();
  if (current) result.push(current);
  return result;
}

function run() {
  const N = 1000000;
  let start = performance.now();
  for (let i = 0; i < N; i++) testOriginal();
  console.log('original:', performance.now() - start);

  start = performance.now();
  for (let i = 0; i < N; i++) testLoop();
  console.log('loop:', performance.now() - start);
}
run();
