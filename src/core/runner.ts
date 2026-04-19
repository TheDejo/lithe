import { getTests } from "./test";

export async function run() {
  const tests = getTests();

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`✓ ${t.name}`);
    } catch (err: any) {
      console.error(`✗ ${t.name}`);
      console.error(err.message);
    }
  }
}