export type TestFn = () => unknown | Promise<unknown>;
export type HookFn = () => unknown | Promise<unknown>;
export type Mode = "run" | "skip" | "only" | "todo";

export interface TestOptions {
  /** Max time in ms before the test fails. */
  timeout?: number;
  /** How many times to re-run a failing test before reporting it as failed. */
  retries?: number;
}

export interface TestCase {
  kind: "test";
  name: string;
  fn?: TestFn;
  mode: Mode;
  options: TestOptions;
  parent: Suite;
}

export interface Hooks {
  beforeAll: HookFn[];
  afterAll: HookFn[];
  beforeEach: HookFn[];
  afterEach: HookFn[];
}

export interface Suite {
  kind: "suite";
  name: string;
  mode: Mode;
  children: Array<Suite | TestCase>;
  hooks: Hooks;
  parent?: Suite;
}

interface RegistryState {
  root: Suite;
  current: Suite;
  hasOnly: boolean;
}

export function createSuite(name: string, mode: Mode = "run", parent?: Suite): Suite {
  return {
    kind: "suite",
    name,
    mode,
    children: [],
    hooks: { beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] },
    parent,
  };
}

// The registry lives on globalThis so that test files importing a different
// copy of lithe (e.g. src vs dist, or a nested node_modules install) still
// register with the runner that is executing them.
const KEY = Symbol.for("lithe.registry");

function state(): RegistryState {
  const g = globalThis as any;
  if (!g[KEY]) {
    const root = createSuite("");
    g[KEY] = { root, current: root, hasOnly: false } satisfies RegistryState;
  }
  return g[KEY];
}

/** Start a fresh collection (called by the runner before loading each file). */
export function resetRegistry(): void {
  const s = state();
  s.root = createSuite("");
  s.current = s.root;
  s.hasOnly = false;
}

export function getRoot(): Suite {
  return state().root;
}

export function hasOnly(): boolean {
  return state().hasOnly;
}

export function addTest(name: string, fn: TestFn | undefined, mode: Mode, options: TestOptions): void {
  const s = state();
  if (mode === "only") s.hasOnly = true;
  s.current.children.push({ kind: "test", name, fn, mode, options, parent: s.current });
}

export function addSuite(name: string, fn: () => void, mode: Mode): void {
  const s = state();
  if (mode === "only") s.hasOnly = true;
  const suite = createSuite(name, mode, s.current);
  s.current.children.push(suite);
  const prev = s.current;
  s.current = suite;
  try {
    const ret = fn() as unknown;
    if (ret && typeof (ret as Promise<unknown>).then === "function") {
      throw new Error(
        `describe("${name}") callback must be synchronous. Put async work in beforeAll/test instead.`
      );
    }
  } finally {
    s.current = prev;
  }
}

export function addHook(type: keyof Hooks, fn: HookFn): void {
  state().current.hooks[type].push(fn);
}
