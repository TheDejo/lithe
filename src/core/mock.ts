type AnyFn = (...args: any[]) => any;

export interface MockResult {
  type: "return" | "throw";
  value: unknown;
}

export interface MockState<F extends AnyFn> {
  calls: Parameters<F>[];
  results: MockResult[];
}

export interface Mock<F extends AnyFn = AnyFn> {
  (...args: Parameters<F>): ReturnType<F>;
  mock: MockState<F>;
  mockImplementation(impl: F): this;
  mockImplementationOnce(impl: F): this;
  mockReturnValue(value: ReturnType<F>): this;
  mockReturnValueOnce(value: ReturnType<F>): this;
  mockResolvedValue(value: Awaited<ReturnType<F>>): this;
  mockResolvedValueOnce(value: Awaited<ReturnType<F>>): this;
  mockRejectedValue(error: unknown): this;
  mockRejectedValueOnce(error: unknown): this;
  /** Clear recorded calls and results. */
  mockClear(): this;
  /** Clear recorded calls and remove all implementations. */
  mockReset(): this;
  /** For spies: put the original method back. */
  mockRestore(): void;
  readonly _isLitheMock: true;
}

/** Create a mock function that records its calls — handy for faking tools or LLM clients. */
export function fn<F extends AnyFn = AnyFn>(implementation?: F): Mock<F> {
  let impl: AnyFn | undefined = implementation;
  let onceQueue: AnyFn[] = [];
  let restore: () => void = () => {};

  const mock = function (this: unknown, ...args: any[]) {
    mock.mock.calls.push(args as Parameters<F>);
    const current = onceQueue.length ? onceQueue.shift() : impl;
    try {
      const value = current ? current.apply(this, args) : undefined;
      mock.mock.results.push({ type: "return", value });
      return value;
    } catch (err) {
      mock.mock.results.push({ type: "throw", value: err });
      throw err;
    }
  } as Mock<F>;

  Object.defineProperty(mock, "_isLitheMock", { value: true });
  mock.mock = { calls: [], results: [] };

  mock.mockImplementation = (f) => ((impl = f), mock);
  mock.mockImplementationOnce = (f) => (onceQueue.push(f), mock);
  mock.mockReturnValue = (v) => mock.mockImplementation((() => v) as F);
  mock.mockReturnValueOnce = (v) => mock.mockImplementationOnce((() => v) as F);
  mock.mockResolvedValue = (v) => mock.mockImplementation((() => Promise.resolve(v)) as F);
  mock.mockResolvedValueOnce = (v) => mock.mockImplementationOnce((() => Promise.resolve(v)) as F);
  mock.mockRejectedValue = (e) => mock.mockImplementation((() => Promise.reject(e)) as F);
  mock.mockRejectedValueOnce = (e) => mock.mockImplementationOnce((() => Promise.reject(e)) as F);
  mock.mockClear = () => {
    mock.mock.calls = [];
    mock.mock.results = [];
    return mock;
  };
  mock.mockReset = () => {
    mock.mockClear();
    impl = undefined;
    onceQueue = [];
    return mock;
  };
  mock.mockRestore = () => restore();
  (mock as any)._setRestore = (r: () => void) => (restore = r);

  return mock;
}

/**
 * Replace `object[method]` with a mock that calls through to the original by default.
 * Call `.mockRestore()` to undo.
 */
export function spyOn<T extends object, K extends keyof T>(
  object: T,
  method: K
): T[K] extends AnyFn ? Mock<T[K]> : never {
  const original = object[method];
  if (typeof original !== "function") {
    throw new TypeError(`Cannot spy on ${String(method)}: it is not a function`);
  }
  const spy = fn(original as unknown as AnyFn);
  (spy as any)._setRestore(() => {
    object[method] = original;
  });
  object[method] = spy as any;
  return spy as any;
}

export function isMock(value: unknown): value is Mock {
  return typeof value === "function" && (value as any)._isLitheMock === true;
}
