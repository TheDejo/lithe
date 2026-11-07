import { addHook, addSuite, addTest, HookFn, TestFn, TestOptions } from "./registry";

type OptionsArg = TestOptions | number | undefined;

function normalize(options: OptionsArg): TestOptions {
  return typeof options === "number" ? { timeout: options } : options ?? {};
}

export interface TestApi {
  (name: string, fn: TestFn, options?: TestOptions | number): void;
  only(name: string, fn: TestFn, options?: TestOptions | number): void;
  skip(name: string, fn?: TestFn, options?: TestOptions | number): void;
  todo(name: string): void;
}

function makeTest(): TestApi {
  const t = ((name: string, fn: TestFn, options?: OptionsArg) =>
    addTest(name, fn, "run", normalize(options))) as TestApi;
  t.only = (name, fn, options) => addTest(name, fn, "only", normalize(options));
  t.skip = (name, fn, options) => addTest(name, fn, "skip", normalize(options));
  t.todo = (name) => addTest(name, undefined, "todo", {});
  return t;
}

export const test: TestApi = makeTest();
export const it: TestApi = test;

export interface DescribeApi {
  (name: string, fn: () => void): void;
  only(name: string, fn: () => void): void;
  skip(name: string, fn: () => void): void;
}

export const describe: DescribeApi = Object.assign(
  (name: string, fn: () => void) => addSuite(name, fn, "run"),
  {
    only: (name: string, fn: () => void) => addSuite(name, fn, "only"),
    skip: (name: string, fn: () => void) => addSuite(name, fn, "skip"),
  }
);

export const beforeAll = (fn: HookFn) => addHook("beforeAll", fn);
export const afterAll = (fn: HookFn) => addHook("afterAll", fn);
export const beforeEach = (fn: HookFn) => addHook("beforeEach", fn);
export const afterEach = (fn: HookFn) => addHook("afterEach", fn);
