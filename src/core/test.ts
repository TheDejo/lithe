type TestFn = () => Promise<void> | void;

const tests: { name: string; fn: TestFn }[] = [];

export function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

export function getTests() {
  return tests;
}